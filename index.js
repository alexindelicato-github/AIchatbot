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
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Structured logging with Winston
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "ai-chatbot" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Webhook notification service
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

// OpenAI API configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// SQLite database for chat history
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

  CREATE TABLE IF NOT EXISTS file_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_uploads_session ON file_uploads(session_id);
`);

const app = express();
const port = 3001;

// Security middleware
app.use(helmet());
app.use(bodyParser.json({ limit: "10kb" }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));

// Rate limiting
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: "Too many requests, please try again later" },
});

// File upload configuration
const UPLOAD_DIR = path.join(__dirname, "uploads");
const ALLOWED_EXTENSIONS = [".txt", ".md", ".json", ".yaml", ".yml", ".xml", ".csv", ".log", ".conf", ".cfg", ".ini", ".py", ".js", ".ts", ".java", ".go", ".rs", ".tf", ".dockerfile"];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`File type ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`));
    }
    cb(null, true);
  },
});

// API key authentication middleware
function authenticate(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.CHATBOT_API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
  }
  next();
}

// Serve index.html
app.get("/", function (req, res) {
  res.sendFile("index.html", { root: "." });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Chatbot API endpoint
app.post("/chat", authenticate, chatLimiter, async (req, res) => {
  try {
    const { messages, session_id } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }

    if (messages.length > 50) {
      return res.status(400).json({ error: "Too many messages (max 50)" });
    }

    // Generate session ID if not provided
    const sessionId = session_id || crypto.randomUUID();

    // Store user message in database
    const lastMessage = messages[messages.length - 1];
    const insertStmt = db.prepare(
      "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
    );
    insertStmt.run(sessionId, lastMessage.role, lastMessage.content);

    logger.info("Chat request received", {
      sessionId,
      messageCount: messages.length,
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a cybersecurity expert, and will assist users in securing their applications",
        },
        ...messages,
      ],
    });

    const assistantMessage = completion.choices[0].message;

    // Store assistant response in database
    insertStmt.run(sessionId, assistantMessage.role, assistantMessage.content);

    logger.info("Chat response sent", {
      sessionId,
      tokensUsed: completion.usage?.total_tokens,
    });

    res.json({
      completion: assistantMessage,
      session_id: sessionId,
    });
  } catch (error) {
    logger.error("Chat endpoint error", {
      error: error.message,
      stack: error.stack,
    });
    await sendWebhook("chat_error", {
      error: error.message,
      endpoint: "/chat",
    });
    res.status(500).json({ error: "An internal error occurred" });
  }
});

// Chat history endpoint
app.get("/history/:sessionId", authenticate, (req, res) => {
  const { sessionId } = req.params;
  const messages = db
    .prepare(
      "SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY created_at ASC"
    )
    .all(sessionId);
  res.json({ session_id: sessionId, messages });
});

// List sessions endpoint
app.get("/sessions", authenticate, (req, res) => {
  const sessions = db
    .prepare(
      `SELECT session_id, COUNT(*) as message_count, MIN(created_at) as started_at, MAX(created_at) as last_message_at
       FROM conversations GROUP BY session_id ORDER BY last_message_at DESC LIMIT 50`
    )
    .all();
  res.json({ sessions });
});

// Usage analytics endpoint
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

// File upload and analysis endpoint
app.post("/analyze", authenticate, chatLimiter, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, "utf-8");

    // Enforce max content length for LLM context
    if (fileContent.length > 50000) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "File content too large for analysis (max 50k chars)" });
    }

    const sessionId = req.body.session_id || crypto.randomUUID();

    logger.info("File analysis requested", {
      sessionId,
      filename: req.file.originalname,
      size: req.file.size,
    });

    // Store the upload record
    db.prepare(
      "INSERT INTO file_uploads (session_id, original_name, stored_name, size_bytes) VALUES (?, ?, ?, ?)"
    ).run(sessionId, req.file.originalname, req.file.filename, req.file.size);

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

    // Store the analysis in conversation history
    const insertStmt = db.prepare(
      "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
    );
    insertStmt.run(sessionId, "user", `[File Upload] ${req.file.originalname}`);
    insertStmt.run(sessionId, "assistant", analysis.content);

    // Clean up uploaded file after analysis
    fs.unlinkSync(filePath);

    logger.info("File analysis completed", { sessionId, filename: req.file.originalname });

    res.json({
      analysis: analysis.content,
      filename: req.file.originalname,
      session_id: sessionId,
    });
  } catch (error) {
    // Clean up file on error
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    logger.error("File analysis error", { error: error.message });
    await sendWebhook("analysis_error", { error: error.message, endpoint: "/analyze" });
    res.status(500).json({ error: "An internal error occurred during file analysis" });
  }
});

// List uploaded files for a session
app.get("/uploads/:sessionId", authenticate, (req, res) => {
  const uploads = db
    .prepare(
      "SELECT original_name, size_bytes, uploaded_at FROM file_uploads WHERE session_id = ? ORDER BY uploaded_at DESC"
    )
    .all(req.params.sessionId);
  res.json({ session_id: req.params.sessionId, uploads });
});

// Webhook test endpoint (admin use)
app.post("/webhook/test", authenticate, async (req, res) => {
  await sendWebhook("test", { message: "Webhook connectivity test" });
  res.json({ status: "sent" });
});

// Start the server
app.listen(port, () => {
  logger.info(`AI Chatbot listening at http://localhost:${port}`);
});
