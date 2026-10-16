import OpenAI from "openai";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import crypto from "crypto";
import winston from "winston";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import "dotenv/config";
import { isModerationEnabled, moderateText } from "./moderation.js";
import { createUploadStore } from "./storage.js";
import { isCveLookupEnabled, extractCveIds, lookupCves, formatCveContext } from "./cveLookup.js";
import { createKnowledgeBase, formatKnowledgeContext } from "./knowledgeBase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------
if (!fs.existsSync("logs")) fs.mkdirSync("logs", { recursive: true });

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: "ai-chatbot" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
});

// ---------------------------------------------------------------------------
// Webhook notifications
// ---------------------------------------------------------------------------
async function sendWebhook(event, payload) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        service: "ai-chatbot",
        ...payload,
      }),
    });
    logger.info("Webhook sent", { event });
  } catch (err) {
    logger.error("Webhook delivery failed", { event, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------------------------------------------------------------------
// Database (SQLite replaces origin's flat JSON files)
// ---------------------------------------------------------------------------
const db = new Database("chatbot.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_session ON conversations(session_id);

  CREATE TABLE IF NOT EXISTS conversation_meta (
    session_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS file_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_uploads_session ON file_uploads(session_id);

  CREATE TABLE IF NOT EXISTS kb_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();
const port = process.env.PORT || 3001;
const host = "0.0.0.0";

app.use(helmet({
  // Allow the Font Awesome CDN used by index.html
  contentSecurityPolicy: false,
}));
app.use(bodyParser.json({ limit: "1mb" }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));

// Rate limiter applied to expensive/LLM-backed routes only
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: "Too many requests, please try again later" },
});

// ---------------------------------------------------------------------------
// Upload configuration
// ---------------------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, "uploads");
const ALLOWED_EXTENSIONS = [
  ".txt", ".md", ".json", ".yaml", ".yml", ".xml", ".csv", ".log",
  ".conf", ".cfg", ".ini", ".py", ".js", ".ts", ".java", ".go", ".rs",
  ".tf", ".dockerfile", ".html", ".css", ".cpp", ".h", ".c", ".sql",
];
const ANALYZE_MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB — strict, for instant security analysis
const CHAT_MAX_FILE_SIZE = 5 * 1024 * 1024;    // 5 MB — general chat attachments

// S3 when S3_BUCKET is set, local disk otherwise — see storage.js
const uploadStore = createUploadStore({ uploadDir: UPLOAD_DIR });
logger.info("Upload storage initialised", { backend: uploadStore.backend });

function extFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`File type ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`));
  }
  cb(null, true);
}

const analyzeUpload = multer({ storage: uploadStore.multerStorage, limits: { fileSize: ANALYZE_MAX_FILE_SIZE }, fileFilter: extFilter });
const chatUpload = multer({ storage: uploadStore.multerStorage, limits: { fileSize: CHAT_MAX_FILE_SIZE }, fileFilter: extFilter });

// ---------------------------------------------------------------------------
// Knowledge base (RAG) — enabled when QDRANT_URL is set, see knowledgeBase.js
// ---------------------------------------------------------------------------
const KB_ALLOWED_EXTENSIONS = [".txt", ".md", ".json", ".yaml", ".yml", ".csv"];
const KB_MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB

const knowledgeBase = createKnowledgeBase({ openai });
if (knowledgeBase.enabled) {
  knowledgeBase.ensureCollection()
    .then(() => logger.info("Knowledge base ready", { collection: knowledgeBase.collection }))
    .catch((err) => logger.error("Knowledge base unavailable", { error: err.message }));
}

const kbUpload = multer({
  storage: multer.memoryStorage(), // documents live in Qdrant, not on disk/S3
  limits: { fileSize: KB_MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!KB_ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`File type ${ext} not allowed. Allowed: ${KB_ALLOWED_EXTENSIONS.join(", ")}`));
    }
    cb(null, true);
  },
});

// Local disk only: serve uploaded files statically (NOT the whole project —
// avoid origin's `express.static(".")`, which exposed source code, .env, etc.)
// With S3, downloads go through short-lived signed URLs instead.
if (uploadStore.backend === "local") {
  app.use("/uploads", express.static(UPLOAD_DIR));
}

// ---------------------------------------------------------------------------
// API key auth — applied ONLY to endpoints meant for direct/API-style access.
// The browser UI (index.html) calls the /api/* routes below with no auth
// header, so those stay open (same-origin, rate-limited). If you want to lock
// down the UI too, add a login/session layer rather than hardcoding a key in
// client-side JS.
// ---------------------------------------------------------------------------
function authenticate(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.CHATBOT_API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Static entry point
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// =============================================================================
// Browser-facing routes (match index.html's fetch() calls — no auth header)
// =============================================================================

// ---- Conversation list ----
app.get("/api/conversations", (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT m.session_id as id, m.title, m.created_at as createdAt, m.updated_at as updatedAt
         FROM conversation_meta m
         ORDER BY m.updated_at DESC LIMIT 50`
      )
      .all();
    res.json(rows);
  } catch (error) {
    logger.error("Error fetching conversations", { error: error.message });
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ---- Create conversation ----
app.post("/api/conversations", (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    const title = req.body?.title || "New Chat";
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO conversation_meta (session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, title, now, now);
    res.status(201).json({ id: sessionId, title, createdAt: now, updatedAt: now });
  } catch (error) {
    logger.error("Error creating conversation", { error: error.message });
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// ---- Get a single conversation's messages ----
app.get("/api/conversations/:id", (req, res) => {
  try {
    const meta = db
      .prepare("SELECT session_id FROM conversation_meta WHERE session_id = ?")
      .get(req.params.id);
    if (!meta) return res.status(404).json({ error: "Conversation not found" });

    const messages = db
      .prepare("SELECT role, content FROM conversations WHERE session_id = ? ORDER BY created_at ASC")
      .all(req.params.id);
    res.json({ messages });
  } catch (error) {
    logger.error("Error fetching conversation", { id: req.params.id, error: error.message });
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// ---- Rename conversation ----
app.put("/api/conversations/:id", (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const result = db
      .prepare("UPDATE conversation_meta SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?")
      .run(title, req.params.id);

    if (result.changes === 0) return res.status(404).json({ error: "Conversation not found" });
    res.json({ success: true, message: "Conversation renamed" });
  } catch (error) {
    logger.error("Error renaming conversation", { id: req.params.id, error: error.message });
    res.status(500).json({ error: "Failed to rename conversation" });
  }
});

// ---- Delete conversation ----
app.delete("/api/conversations/:id", (req, res) => {
  try {
    const { id } = req.params;
    db.prepare("DELETE FROM conversations WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM conversation_meta WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM file_uploads WHERE session_id = ?").run(id);
    res.json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    logger.error("Error deleting conversation", { id: req.params.id, error: error.message });
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// ---- General file upload (chat attachments) ----
app.post("/api/upload", chatUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const storedName = await uploadStore.save(req.file);
    db.prepare(
      "INSERT INTO file_uploads (session_id, original_name, stored_name, size_bytes) VALUES (?, ?, ?, ?)"
    ).run(req.body?.conversationId || null, req.file.originalname, storedName, req.file.size);

    res.json({
      success: true,
      file: {
        name: req.file.originalname,
        path: storedName,
        url: `/api/files/${encodeURIComponent(storedName)}`,
        size: req.file.size,
      },
    });
  } catch (error) {
    logger.error("Upload error", { error: error.message });
    res.status(500).json({ error: "Failed to upload file" });
  }
});

// ---- Download an uploaded file (redirects to a signed S3 URL or the local static route) ----
app.get("/api/files/:name", async (req, res) => {
  try {
    const name = path.basename(req.params.name);
    const known = db.prepare("SELECT 1 FROM file_uploads WHERE stored_name = ?").get(name);
    if (!known) return res.status(404).json({ error: "File not found" });

    res.redirect(302, await uploadStore.downloadUrl(name));
  } catch (error) {
    logger.error("Download URL error", { error: error.message });
    res.status(500).json({ error: "Failed to get download URL" });
  }
});

// ---- Core chat endpoint (handles optional file context) ----
app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const { messages, conversationId, filePath } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }
    if (messages.length > 50) {
      return res.status(400).json({ error: "Too many messages (max 50)" });
    }

    const sessionId = conversationId || crypto.randomUUID();
    const now = new Date().toISOString();

    // Ensure a conversation_meta row exists for this session
    db.prepare(
      `INSERT INTO conversation_meta (session_id, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at`
    ).run(sessionId, now, now);

    // If a file was attached, read it and fold its content into the prompt
    let filePrompt = "";
    if (filePath) {
      const stored = await uploadStore.read(filePath);
      if (stored) {
        const fileSizeInMB = stored.size / (1024 * 1024);
        if (fileSizeInMB <= 5) {
          const fileContent = stored.content;
          const fileName = path.basename(filePath);
          filePrompt = `The user has uploaded a file named "${fileName}". Here is the content of the file:\n\n${fileContent}\n\nPlease analyze or respond to the content of this file.`;
        } else {
          filePrompt = `The user has uploaded a file that is too large to process directly (${fileSizeInMB.toFixed(2)} MB). Please provide instructions on how you'd like me to analyze this file.`;
        }
      } else {
        filePrompt = "The file you uploaded could not be found or accessed.";
      }
    }

    const chatMessages = filePrompt
      ? [...messages, { role: "user", content: filePrompt }]
      : messages;

    // Screen the newest user input (and any attached file) before it reaches the model
    if (isModerationEnabled()) {
      const latestUser = [...messages].reverse().find((m) => m.role === "user");
      const screenText = [latestUser?.content, filePrompt].filter(Boolean).join("\n\n");
      const moderation = await moderateText(openai, screenText);

      if (moderation.error) {
        logger.warn("Moderation check failed, allowing request", { sessionId, error: moderation.error });
      } else if (moderation.flagged) {
        logger.warn("Chat request blocked by moderation", { sessionId, categories: moderation.categories });
        await sendWebhook("moderation_flagged", { endpoint: "/api/chat", categories: moderation.categories });
        return res.status(400).json({
          error: "Your message was flagged by content moderation and was not sent",
          categories: moderation.categories,
        });
      }
    }

    // Enrich with OSV.dev details for any CVE IDs in the newest user message.
    // This context goes to the model only; it isn't stored with the conversation.
    let cveContext = "";
    let cveIds = [];
    if (isCveLookupEnabled()) {
      const latestUser = [...messages].reverse().find((m) => m.role === "user");
      cveIds = extractCveIds(latestUser?.content);
      if (cveIds.length) {
        const { records, failures } = await lookupCves(cveIds);
        if (failures.length) logger.warn("CVE lookup failed for some IDs", { sessionId, failures });
        cveIds = records.map((r) => r.id);
        cveContext = formatCveContext(records);
        logger.info("CVE context added", { sessionId, cves: cveIds });
      }
    }

    // Retrieve knowledge-base excerpts relevant to the newest user message.
    // They go to the model only; they aren't stored with the conversation.
    let kbContext = "";
    let sources = [];
    if (knowledgeBase.enabled) {
      const latestUser = [...messages].reverse().find((m) => m.role === "user");
      try {
        const hits = await knowledgeBase.search(latestUser?.content);
        kbContext = formatKnowledgeContext(hits);
        sources = [...new Map(hits.map((h) => [h.documentId, { id: h.documentId, title: h.title }])).values()];
        if (hits.length) logger.info("Knowledge base context added", { sessionId, chunks: hits.length });
      } catch (err) {
        logger.warn("Knowledge base retrieval failed, continuing without it", { sessionId, error: err.message });
      }
    }

    const lastMessage = chatMessages[chatMessages.length - 1];
    const insertStmt = db.prepare(
      "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
    );
    insertStmt.run(sessionId, lastMessage.role, lastMessage.content);

    logger.info("Chat request received", { sessionId, messageCount: chatMessages.length });

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a cybersecurity expert, and will assist users in securing their applications. If the user shares files, analyze them carefully to provide security insights.",
        },
        ...(cveContext ? [{ role: "system", content: cveContext }] : []),
        ...(kbContext ? [{ role: "system", content: kbContext }] : []),
        ...chatMessages,
      ],
    });

    const assistantMessage = completion.choices[0].message;
    insertStmt.run(sessionId, assistantMessage.role, assistantMessage.content);

    logger.info("Chat response sent", {
      sessionId,
      tokensUsed: completion.usage?.total_tokens,
    });

    res.json({
      completion: assistantMessage,
      session_id: sessionId,
      cves: cveIds,
      sources,
    });
  } catch (error) {
    logger.error("Chat endpoint error", { error: error.message, stack: error.stack });
    await sendWebhook("chat_error", { error: error.message, endpoint: "/api/chat" });
    res.status(500).json({ error: "Something went wrong" });
  }
});

// ---- Export: JSON ----
app.get("/api/export/:id/json", (req, res) => {
  try {
    const { id } = req.params;
    const meta = db.prepare("SELECT * FROM conversation_meta WHERE session_id = ?").get(id);
    if (!meta) return res.status(404).json({ error: "Conversation not found" });

    const messages = db
      .prepare("SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY created_at ASC")
      .all(id);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${id}.json"`);
    res.json({ ...meta, messages });
  } catch (error) {
    logger.error("Export (json) error", { id: req.params.id, error: error.message });
    res.status(500).json({ error: "Failed to export conversation" });
  }
});

// ---- Export: CSV ----
app.get("/api/export/:id/csv", (req, res) => {
  try {
    const { id } = req.params;
    const messages = db
      .prepare("SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY created_at ASC")
      .all(id);
    if (messages.length === 0) return res.status(404).json({ error: "Conversation not found" });

    let csvContent = "Role,Content,Timestamp\n";
    for (const msg of messages) {
      const content = msg.content.replace(/"/g, '""').replace(/\n/g, " ");
      csvContent += `${msg.role},"${content}","${msg.created_at}"\n`;
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${id}.csv"`);
    res.send(csvContent);
  } catch (error) {
    logger.error("Export (csv) error", { id: req.params.id, error: error.message });
    res.status(500).json({ error: "Failed to export conversation" });
  }
});

// =============================================================================
// API-key-protected routes (direct/programmatic access — not called by the
// bundled UI). Use these with `X-API-Key: <CHATBOT_API_KEY>`.
// =============================================================================

// ---- Session-based history (legacy / API clients) ----
app.get("/history/:sessionId", authenticate, (req, res) => {
  const { sessionId } = req.params;
  const messages = db
    .prepare("SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId);
  res.json({ session_id: sessionId, messages });
});

// ---- Analytics ----
app.get("/analytics", authenticate, (req, res) => {
  const stats = db
    .prepare(
      `SELECT
         COUNT(DISTINCT session_id) as total_sessions,
         COUNT(*) as total_messages,
         COUNT(CASE WHEN role = 'user' THEN 1 END) as user_messages,
         COUNT(CASE WHEN role = 'assistant' THEN 1 END) as assistant_messages,
         MIN(created_at) as first_message,
         MAX(created_at) as last_message
       FROM conversations`
    )
    .get();

  const dailyActivity = db
    .prepare(
      `SELECT DATE(created_at) as date, COUNT(*) as messages
       FROM conversations
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`
    )
    .all();

  logger.info("Analytics requested");
  res.json({ stats, daily_activity: dailyActivity });
});

// ---- Instant security analysis of an uploaded file ----
app.post("/analyze", authenticate, chatLimiter, analyzeUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const storedName = await uploadStore.save(req.file);
    const { content: fileContent } = await uploadStore.read(storedName);

    if (fileContent.length > 50000) {
      await uploadStore.remove(storedName);
      return res.status(400).json({ error: "File content too large for analysis (max 50k chars)" });
    }

    const sessionId = req.body.session_id || crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO conversation_meta (session_id, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO NOTHING`
    ).run(sessionId, now, now);

    logger.info("File analysis requested", {
      sessionId,
      filename: req.file.originalname,
      size: req.file.size,
    });

    db.prepare(
      "INSERT INTO file_uploads (session_id, original_name, stored_name, size_bytes) VALUES (?, ?, ?, ?)"
    ).run(sessionId, req.file.originalname, storedName, req.file.size);

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a cybersecurity expert. Analyze the following file for security vulnerabilities, misconfigurations, and best practice violations. Provide a structured report with severity ratings.",
        },
        {
          role: "user",
          content: `Analyze this file (${req.file.originalname}):\n\n${fileContent}`,
        },
      ],
    });

    const analysis = completion.choices[0].message;

    const insertStmt = db.prepare(
      "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
    );
    insertStmt.run(sessionId, "user", `[File Upload] ${req.file.originalname}`);
    insertStmt.run(sessionId, "assistant", analysis.content);

    await uploadStore.remove(storedName);

    logger.info("File analysis completed", { sessionId, filename: req.file.originalname });

    res.json({
      analysis: analysis.content,
      filename: req.file.originalname,
      session_id: sessionId,
    });
  } catch (error) {
    if (req.file?.filename) {
      await uploadStore.remove(req.file.filename).catch(() => {});
    }
    logger.error("File analysis error", { error: error.message });
    await sendWebhook("analysis_error", { error: error.message, endpoint: "/analyze" });
    res.status(500).json({ error: "An internal error occurred during file analysis" });
  }
});

// ---- List uploads tied to a session ----
app.get("/uploads/:sessionId", authenticate, (req, res) => {
  const uploads = db
    .prepare(
      "SELECT original_name, size_bytes, uploaded_at FROM file_uploads WHERE session_id = ? ORDER BY uploaded_at DESC"
    )
    .all(req.params.sessionId);
  res.json({ session_id: req.params.sessionId, uploads });
});

// ---- Knowledge base: ingest a reference document ----
function requireKnowledgeBase(req, res, next) {
  if (!knowledgeBase.enabled) {
    return res.status(503).json({ error: "Knowledge base is not configured (set QDRANT_URL)" });
  }
  next();
}

app.post("/api/kb/documents", authenticate, requireKnowledgeBase, chatLimiter, kbUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const documentId = crypto.randomUUID();
    const title = (req.body?.title || req.file.originalname).slice(0, 200);
    const text = req.file.buffer.toString("utf8");

    const { chunks } = await knowledgeBase.ingest({ documentId, title, text });
    if (!chunks) return res.status(400).json({ error: "Document is empty" });

    db.prepare(
      "INSERT INTO kb_documents (id, title, original_name, size_bytes, chunk_count) VALUES (?, ?, ?, ?, ?)"
    ).run(documentId, title, req.file.originalname, req.file.size, chunks);

    logger.info("Knowledge base document ingested", { documentId, title, chunks });
    await sendWebhook("kb_document_ingested", { documentId, title, chunks });
    res.status(201).json({ id: documentId, title, chunks });
  } catch (error) {
    logger.error("Knowledge base ingest error", { error: error.message });
    res.status(500).json({ error: "Failed to ingest document" });
  }
});

// ---- Knowledge base: list documents ----
app.get("/api/kb/documents", authenticate, requireKnowledgeBase, (req, res) => {
  const documents = db
    .prepare("SELECT id, title, original_name, size_bytes, chunk_count, created_at FROM kb_documents ORDER BY created_at DESC")
    .all();
  res.json({ documents });
});

// ---- Knowledge base: delete a document and its vectors ----
app.delete("/api/kb/documents/:id", authenticate, requireKnowledgeBase, async (req, res) => {
  try {
    const doc = db.prepare("SELECT id FROM kb_documents WHERE id = ?").get(req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    await knowledgeBase.deleteDocument(doc.id);
    db.prepare("DELETE FROM kb_documents WHERE id = ?").run(doc.id);
    logger.info("Knowledge base document deleted", { documentId: doc.id });
    res.json({ success: true });
  } catch (error) {
    logger.error("Knowledge base delete error", { id: req.params.id, error: error.message });
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ---- Webhook connectivity test ----
app.post("/webhook/test", authenticate, async (req, res) => {
  await sendWebhook("test", { message: "Webhook connectivity test" });
  res.json({ status: "sent" });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(port, host, () => {
  logger.info(`AI Chatbot listening at http://${host}:${port}`);
  console.log(`AI Chatbot server running at http://${host}:${port}`);
  console.log("You can access this server on your local network via:");
  console.log(`1. http://localhost:${port} (from this device)`);

  const nets = os.networkInterfaces();
  let localIP = "";
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        localIP = net.address;
        break;
      }
    }
    if (localIP) break;
  }
  console.log(localIP ? `2. You can access the server at http://${localIP}:${port}` : "Could not determine local IP address.");
});
