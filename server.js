/**
 * Express web server for Pahadi Swasthya Saathi.
 * Serves the modern chat UI and provides REST API endpoints for the Agentic AI brain.
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

import { getLLM } from "./llm.js";
import { Retriever } from "./rag.js";
import { Orchestrator } from "./agents.js";
import * as tools from "./tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8501;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Initialize AI brain
const llm = getLLM();
const retriever = new Retriever();
const brain = new Orchestrator(llm, retriever, "demo-user");

// Status endpoint
app.get("/api/status", (req, res) => {
  const reminders = tools.listReminders("demo-user");
  res.json({
    modelName: llm.name,
    isMock: llm.isMock,
    reminders,
  });
});

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  const { message, history = [], uiLang = "auto", phone = null } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const result = await brain.handle(message.trim(), history, uiLang, phone);
    res.json(result);
  } catch (error) {
    console.error("Chat handling error:", error);
    res.status(500).json({
      answer: `Sorry, something went wrong (${error.name || "Error"}). For urgent problems call 108.`,
      trace: [],
      sources: [],
      lang: "en",
    });
  }
});

// Reminders endpoints
app.get("/api/reminders", (req, res) => {
  const reminders = tools.listReminders("demo-user");
  res.json({ reminders });
});

app.post("/api/reminders", (req, res) => {
  const { medicine, times, phone } = req.body;
  if (!medicine) {
    return res.status(400).json({ error: "Medicine name is required" });
  }
  const rec = tools.addReminder("demo-user", medicine, times, phone);
  res.json({ reminder: rec, reminders: tools.listReminders("demo-user") });
});

app.delete("/api/reminders/:id", (req, res) => {
  const { id } = req.params;
  tools.deleteReminder(id);
  res.json({ success: true, reminders: tools.listReminders("demo-user") });
});

const server = app.listen(PORT, () => {
  console.log(`\n🏔️ Pahadi Swasthya Saathi running at: http://localhost:${PORT}`);
  console.log(`🧠 AI Provider: ${llm.name}`);
  if (llm.isMock) {
    console.log("ℹ️ Running in MOCK mode (no API key configured). Set GEMINI_API_KEY or WATSONX_APIKEY in .env for real AI.");
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${PORT} is already in use by another process.`);
    console.error(`💡 Tip: Run with another port, for example: PORT=8502 npm start`);
    console.error(`   Or find and stop the process using port ${PORT}: npx kill-port ${PORT}\n`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
