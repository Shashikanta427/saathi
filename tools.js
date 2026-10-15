/**
 * Tools the agents can call. Plain JavaScript functions: reliable, testable, no AI guessing.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDataPath(rel) {
  const cwdPath = path.join(process.cwd(), "data", rel);
  if (fs.existsSync(cwdPath)) return cwdPath;
  return path.join(__dirname, "data", rel);
}

const defaultReminderPath = resolveDataPath("reminders.json");
export let REMINDER_FILE = process.env.VERCEL
  ? path.join("/tmp", "reminders.json")
  : defaultReminderPath;
export let FACILITY_FILE = resolveDataPath("facilities.json");

if (process.env.VERCEL && !fs.existsSync(REMINDER_FILE) && fs.existsSync(defaultReminderPath)) {
  try {
    fs.copyFileSync(defaultReminderPath, REMINDER_FILE);
  } catch (e) {
    // ignore
  }
}

export function setReminderFile(filePath) {
  REMINDER_FILE = filePath;
}

export function setFacilityFile(filePath) {
  FACILITY_FILE = filePath;
}

// ---------------- Safety (runs BEFORE any AI) ----------------
export const MIND_KEYS = [
  "suicide", "kill myself", "end my life", "mar jana", "marna chahta", "jeena nahi",
  "आत्महत्या", "मरना चाहता", "मरना चाहती", "जीना नहीं"
];

export const EMERGENCY_KEYS = [
  "chest pain", "seene mein dard", "seene me dard", "सीने", "सीना", "saans nahi", "saans phool",
  "सांस नहीं", "सांस फूल", "can't breathe", "behosh", "बेहोश", "unconscious", "bleeding", "khoon bah",
  "खून बह", "saanp", "सांप", "snake", "lakwa", "लकवा", "stroke", "daura", "दौरा", "seizure",
  "accident", "दुर्घटना", "zeher", "जहर", "poison", "fit aa", "convulsion"
];

export const SAFETY_TEXT = {
  mind: {
    hi: "आप अकेले नहीं हैं। कृपया अभी किसी भरोसेमंद इंसान के पास रहें और उनसे बात करें। मुफ़्त और गोपनीय मदद के लिए Tele-MANAS 14416 पर कॉल करें, या तुरंत 112 / 108 पर।",
    en: "You are not alone. Please stay with someone you trust and talk to them now. For free, confidential support call Tele-MANAS on 14416, or 112 / 108 immediately.",
  },
  emergency: {
    hi: "🚨 यह आपातकाल हो सकता है। इंतज़ार न करें: अभी 108 पर एम्बुलेंस बुलाएँ या नज़दीकी अस्पताल पहुँचें। मरीज़ को अकेला न छोड़ें, और डॉक्टर के कहे बिना खाना-पीना या घरेलू दवा न दें।",
    en: "🚨 This could be an emergency. Do not wait: call an ambulance on 108 now or reach the nearest hospital. Do not leave the patient alone, and give no food, drink or home remedies unless a doctor says so.",
  },
};

export function checkRedFlags(text = "") {
  const s = text.toLowerCase();
  if (MIND_KEYS.some(k => s.includes(k))) {
    return "mind";
  }
  if (EMERGENCY_KEYS.some(k => s.includes(k))) {
    return "emergency";
  }
  return null;
}

// ---------------- Report interpreter ----------------
function _num(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function interpretReport(sex = null, hb = null, fbs = null, sys = null, dia = null) {
  const isFemale = String(sex || "").toUpperCase().startsWith("F") || String(sex || "").toLowerCase().includes("महिला") || String(sex || "").toLowerCase().includes("woman") || String(sex || "").toLowerCase().includes("female");
  const sexNorm = isFemale ? "F" : "M";

  const numHb = _num(hb);
  const numFbs = _num(fbs);
  const numSys = _num(sys);
  const numDia = _num(dia);

  const facts = [];

  if (numHb !== null) {
    const [low, high] = sexNorm === "F" ? [12, 15.5] : [13, 17.5];
    let status = numHb < low ? "LOW (possible anaemia, see doctor)" : (numHb > high ? "HIGH (ask doctor)" : "NORMAL");
    if (numHb < 8) {
      status = "VERY LOW (see doctor soon)";
    }
    facts.push(`Haemoglobin ${numHb} g/dL: ${status}. Normal range for ${sexNorm === "F" ? "women" : "men"}: ${low}-${high} g/dL.`);
  }

  if (numFbs !== null) {
    let status = "NORMAL";
    if (numFbs < 70) {
      status = "LOW (see doctor)";
    } else if (numFbs >= 126) {
      status = "HIGH, in the diabetes range (doctor must confirm with repeat test)";
    } else if (numFbs >= 100) {
      status = "RAISED, pre-diabetes range (see doctor, watch diet and activity)";
    }
    facts.push(`Fasting blood sugar ${numFbs} mg/dL: ${status}. Normal: 70-99 mg/dL.`);
  }

  if (numSys !== null && numDia !== null) {
    let status = "NORMAL";
    if (numSys >= 180 || numDia >= 120) {
      status = "VERY HIGH (see doctor today; call 108 if headache, chest pain or breathlessness)";
    } else if (numSys >= 140 || numDia >= 90) {
      status = "HIGH (see doctor, reduce salt, recheck on different days)";
    } else if (numSys >= 120 || numDia >= 80) {
      status = "SLIGHTLY RAISED (reduce salt, walk daily, check regularly)";
    } else if (numSys < 90 || numDia < 60) {
      status = "LOW (see doctor if dizzy or weak)";
    }
    facts.push(`Blood pressure ${Math.round(numSys)}/${Math.round(numDia)} mmHg: ${status}. Normal: below 120/80 mmHg.`);
  }

  return facts;
}

// ---------------- Reminders ----------------
export function loadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export function saveJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function addReminder(userId, medicine, times, phone = null) {
  const clean = [];
  const timesArray = Array.isArray(times) ? times : (times ? [times] : []);
  for (const t of timesArray) {
    const m = String(t).match(/^\s*(\d{1,2}):(\d{2})\s*$/);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      if (h < 24 && min < 60) {
        clean.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
      }
    }
  }
  if (clean.length === 0) {
    clean.push("08:00");
  }

  const items = loadJson(REMINDER_FILE);
  const rec = {
    id: crypto.randomBytes(4).toString("hex"),
    user: userId,
    phone: phone || null,
    medicine: medicine || "medicine",
    times: clean,
    created: new Date().toISOString().slice(0, 19),
    last_sent: null,
  };
  items.push(rec);
  saveJson(REMINDER_FILE, items);
  return rec;
}

export function listReminders(userId) {
  const items = loadJson(REMINDER_FILE);
  return items.filter(r => r.user === userId);
}

export function deleteReminder(reminderId) {
  const items = loadJson(REMINDER_FILE);
  const filtered = items.filter(r => r.id !== reminderId);
  saveJson(REMINDER_FILE, filtered);
  return true;
}

export async function sendWhatsApp(phone, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !phone) {
    return { ok: false, info: "Twilio not configured (demo mode): message not sent" };
  }
  try {
    const twilioModule = await import("twilio");
    const twilioClient = twilioModule.default(sid, token);
    const fromNumber = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
    await twilioClient.messages.create({
      from: fromNumber,
      to: phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`,
      body,
    });
    return { ok: true, info: "sent" };
  } catch (e) {
    return { ok: false, info: `send failed: ${e.message || e}` };
  }
}

// ---------------- Nearby care ----------------
export function findFacilities(district) {
  let data = { facilities: [], helplines: [], note: "" };
  try {
    if (fs.existsSync(FACILITY_FILE)) {
      data = JSON.parse(fs.readFileSync(FACILITY_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading facilities file:", err);
  }

  const d = (district || "").trim().toLowerCase();
  const hits = (data.facilities || []).filter(f => d && f.district && f.district.toLowerCase().includes(d));
  return {
    hits,
    helplines: data.helplines || [],
    note: data.note || "",
  };
}
