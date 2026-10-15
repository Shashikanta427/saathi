/**
 * Sends saved reminders at the right time. Run in a terminal:  npm run scheduler (or node scheduler.js)
 * Without Twilio keys it just prints the messages (demo mode).
 */
import dotenv from "dotenv";
dotenv.config();

import * as tools from "./tools.js";

console.log("⏰ Reminder scheduler started. Press Ctrl+C to stop.");

async function checkAndSendReminders() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const hm = `${hours}:${minutes}`;
  const today = now.toISOString().slice(0, 10);

  const items = tools.loadJson(tools.REMINDER_FILE);
  let changed = false;

  for (const r of items) {
    const key = `${today} ${hm}`;
    if (r.times && r.times.includes(hm) && r.last_sent !== key) {
      const msg = `नमस्ते! 💊 आपकी '${r.medicine}' लेने का समय हो गया है (${hm})। स्वस्थ रहें! - पहाड़ी स्वास्थ्य साथी`;
      const { info } = await tools.sendWhatsApp(r.phone, msg);
      console.log(`[${key}] ${r.medicine} -> ${r.phone || "no phone"}: ${info}`);
      r.last_sent = key;
      changed = true;
    }
  }

  if (changed) {
    tools.saveJson(tools.REMINDER_FILE, items);
  }
}

// Check every 20 seconds
setInterval(checkAndSendReminders, 20000);
checkAndSendReminders();
