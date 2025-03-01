import OpenAI from "openai";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import "dotenv/config"; // Loads environment variables from a .env file
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from 'os';

// Get directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Configure multer storage for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// OpenAI API configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure you set this in your environment variables
});

const app = express();
const port = process.env.PORT || 3002; // Changed default port to 3002 to avoid conflicts
const host = '0.0.0.0'; // Allow connections from any IP address

app.use(bodyParser.json({limit: '16mb'}));
app.use(cors({ origin: '*' })); // Allows requests from any origin (not recommended for production)
app.use(express.static("."));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// Get all chat history
app.get("/api/conversations", (req, res) => {
  try {
    const conversationsPath = path.join(dataDir, "conversations.json");
    if (!fs.existsSync(conversationsPath)) {
      return res.json([]);
    }
    const conversations = JSON.parse(fs.readFileSync(conversationsPath, "utf8"));
    res.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Delete a conversation
app.delete("/api/conversations/:id", (req, res) => {
  try {
    const conversationId = req.params.id;
    const conversationsPath = path.join(dataDir, "conversations.json");
    const conversationFilePath = path.join(dataDir, `${conversationId}.json`);
    
    // Check if conversation exists
    if (!fs.existsSync(conversationsPath)) {
      return res.status(404).json({ error: "No conversations found" });
    }
    
    // Read conversations
    const conversations = JSON.parse(fs.readFileSync(conversationsPath, "utf8"));
    
    // Filter out the conversation to delete
    const updatedConversations = conversations.filter(c => c.id !== conversationId);
    
    // Write updated conversations back to file
    fs.writeFileSync(conversationsPath, JSON.stringify(updatedConversations, null, 2));
    
    // Delete the conversation file if it exists
    if (fs.existsSync(conversationFilePath)) {
      fs.unlinkSync(conversationFilePath);
    }
    
    res.json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    console.error(`Error deleting conversation ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// Rename a conversation
app.put("/api/conversations/:id", (req, res) => {
  try {
    const conversationId = req.params.id;
    const { title } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    
    const conversationsPath = path.join(dataDir, "conversations.json");
    
    // Check if conversations file exists
    if (!fs.existsSync(conversationsPath)) {
      return res.status(404).json({ error: "No conversations found" });
    }
    
    // Read conversations
    const conversations = JSON.parse(fs.readFileSync(conversationsPath, "utf8"));
    
    // Find and update the conversation
    const updatedConversations = conversations.map(c => {
      if (c.id === conversationId) {
        return {
          ...c,
          title: title,
          updatedAt: new Date().toISOString()
        };
      }
      return c;
    });
    
    // Write updated conversations back to file
    fs.writeFileSync(conversationsPath, JSON.stringify(updatedConversations, null, 2));
    
    res.json({ success: true, message: "Conversation renamed" });
  } catch (error) {
    console.error(`Error renaming conversation ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to rename conversation" });
  }
});

// Get conversation by ID
app.get("/api/conversations/:id", (req, res) => {
  try {
    const conversationId = req.params.id;
    const conversationPath = path.join(dataDir, `${conversationId}.json`);
    
    if (!fs.existsSync(conversationPath)) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    const conversation = JSON.parse(fs.readFileSync(conversationPath, "utf8"));
    res.json(conversation);
  } catch (error) {
    console.error(`Error fetching conversation ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// Create new conversation
app.post("/api/conversations", (req, res) => {
  try {
    const { title } = req.body;
    const conversationId = Date.now().toString();
    const newConversation = {
      id: conversationId,
      title: title || "New Conversation",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Save conversation metadata
    const conversationsPath = path.join(dataDir, "conversations.json");
    let conversations = [];
    
    if (fs.existsSync(conversationsPath)) {
      conversations = JSON.parse(fs.readFileSync(conversationsPath, "utf8"));
    }
    
    conversations.unshift(newConversation);
    fs.writeFileSync(conversationsPath, JSON.stringify(conversations, null, 2));
    
    // Save empty conversation messages
    fs.writeFileSync(
      path.join(dataDir, `${conversationId}.json`),
      JSON.stringify({ messages: [] }, null, 2)
    );
    
    res.status(201).json(newConversation);
  } catch (error) {
    console.error("Error creating conversation:", error);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// File upload endpoint
app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ 
      success: true, 
      file: {
        name: req.file.originalname,
        path: fileUrl,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

// Chatbot API endpoint with file handling
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, conversationId, filePath } = req.body;
    
    let fileContent = "";
    let filePrompt = "";
    
    // If a file was uploaded, read its content
    if (filePath) {
      const fullPath = path.join(__dirname, filePath);
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        
        // Check if file is not too large to process
        if (fileSizeInMB <= 5) { // Limit to 5MB for text processing
          fileContent = fs.readFileSync(fullPath, "utf8");
          const fileName = path.basename(filePath);
          filePrompt = `The user has uploaded a file named "${fileName}". Here is the content of the file:\n\n${fileContent}\n\nPlease analyze or respond to the content of this file.`;
        } else {
          filePrompt = `The user has uploaded a file that is too large to process directly (${fileSizeInMB.toFixed(2)} MB). Please provide instructions on how you'd like me to analyze this file.`;
        }
      } else {
        filePrompt = "The file you uploaded could not be found or accessed.";
      }
    }
    
    // Add file content to the messages if available
    const chatMessages = filePrompt 
      ? [...messages, { role: "user", content: filePrompt }]
      : messages;
    
    console.log("Processing chat with messages:", chatMessages.length);
    
    // Stream the response if streaming parameter is provided
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a cybersecurity expert, and will assist users in securing their applications. If the user shares files, analyze them carefully to provide security insights." },
        ...chatMessages,
      ],
    });
    
    const responseMessage = completion.choices[0].message;
    
    // Save conversation if conversationId is provided
    if (conversationId) {
      const conversationPath = path.join(dataDir, `${conversationId}.json`);
      let conversation = { messages: [] };
      
      if (fs.existsSync(conversationPath)) {
        conversation = JSON.parse(fs.readFileSync(conversationPath, "utf8"));
      }
      
      // Add the new messages to the conversation
      if (filePrompt) {
        conversation.messages.push({ role: "user", content: filePrompt });
      } else {
        conversation.messages.push(messages[messages.length - 1]); // Add only the last user message
      }
      
      conversation.messages.push(responseMessage);
      
      // Save updated conversation
      fs.writeFileSync(conversationPath, JSON.stringify(conversation, null, 2));
      
      // Update conversation metadata (last updated time)
      const conversationsPath = path.join(dataDir, "conversations.json");
      if (fs.existsSync(conversationsPath)) {
        const conversations = JSON.parse(fs.readFileSync(conversationsPath, "utf8"));
        const updatedConversations = conversations.map(conv => {
          if (conv.id === conversationId) {
            return {
              ...conv,
              updatedAt: new Date().toISOString()
            };
          }
          return conv;
        });
        
        fs.writeFileSync(conversationsPath, JSON.stringify(updatedConversations, null, 2));
      }
    }
    
    res.json({
      completion: responseMessage,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Export endpoints - download conversations in different formats
app.get("/api/export/:id/json", (req, res) => {
  try {
    const conversationId = req.params.id;
    const conversationPath = path.join(dataDir, `${conversationId}.json`);
    
    if (!fs.existsSync(conversationPath)) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    // Get conversation data
    const conversation = JSON.parse(fs.readFileSync(conversationPath, "utf8"));
    
    // Get conversation metadata
    const conversationsPath = path.join(dataDir, "conversations.json");
    let metadata = {};
    
    if (fs.existsSync(conversationsPath)) {
      const conversations = JSON.parse(fs.readFileSync(conversationsPath, "utf8"));
      metadata = conversations.find(c => c.id === conversationId) || {};
    }
    
    // Combine data and metadata
    const exportData = {
      ...metadata,
      messages: conversation.messages
    };
    
    // Set headers for file download
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${conversationId}.json"`);
    
    res.json(exportData);
  } catch (error) {
    console.error(`Error exporting conversation ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to export conversation" });
  }
});

app.get("/api/export/:id/csv", (req, res) => {
  try {
    const conversationId = req.params.id;
    const conversationPath = path.join(dataDir, `${conversationId}.json`);
    
    if (!fs.existsSync(conversationPath)) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    // Get conversation data
    const conversation = JSON.parse(fs.readFileSync(conversationPath, "utf8"));
    
    // Get conversation metadata for timestamps
    const conversationsPath = path.join(dataDir, "conversations.json");
    let createdAt = new Date().toISOString();
    
    if (fs.existsSync(conversationsPath)) {
      const conversations = JSON.parse(fs.readFileSync(conversationsPath, "utf8"));
      const metadata = conversations.find(c => c.id === conversationId);
      if (metadata) {
        createdAt = metadata.createdAt;
      }
    }
    
    // Create CSV content
    let csvContent = "Role,Content,Timestamp\n";
    
    conversation.messages.forEach((msg, index) => {
      // Approximate timestamps based on message order
      const timestamp = new Date(createdAt);
      timestamp.setMinutes(timestamp.getMinutes() + index);
      
      // Escape content for CSV format
      const content = msg.content
        .replace(/"/g, '""') // Escape double quotes
        .replace(/\n/g, ' '); // Replace newlines with spaces
      
      csvContent += `${msg.role},"${content}","${timestamp.toISOString()}"\n`;
    });
    
    // Set headers for file download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${conversationId}.csv"`);
    
    res.send(csvContent);
  } catch (error) {
    console.error(`Error exporting conversation ${req.params.id}:`, error);
    res.status(500).json({ error: "Failed to export conversation" });
  }
});

// OS module is already imported at the top

// Start the server
app.listen(port, host, () => {
  console.log(`AI Chatbot server running at http://${host}:${port}`);
  console.log('You can access this server on your local network via:');
  console.log(`1. http://localhost:${port} (from this device)`);
  
// Ensure nets is declared only once
const nets = os.networkInterfaces();

// Declare localIP only once at the beginning
let localIP = '';

// Find local IP address in the network interfaces
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) {
      localIP = net.address;
      if (localIP) break;
    }
  }
  if (localIP) break;
}

// Use localIP
if (localIP) {
  console.log(`2. You can access the server at http://${localIP}:${port}`);
} else {
  console.log('Could not determine local IP address.');
}

  
});
