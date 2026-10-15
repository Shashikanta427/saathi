/**
 * Multi-agent brain of Pahadi Swasthya Saathi.
 *
 * Flow for every message:
 *   1. Safety agent   (plain rules, no AI)  -> emergency / mental-health messages are returned immediately
 *   2. Orchestrator   (LLM)                 -> decides which specialist agents to run, and extracts arguments (JSON plan)
 *   3. Specialist agents (tools + RAG)      -> health_qa, report, reminder, nearby, chitchat
 *   4. Composer       (LLM)                 -> writes ONE simple answer using only the facts and context gathered
 *   5. Guard          (plain rules)         -> adds disclaimer, 108 note, blocks dosage advice
 */
import { extractJson } from "./llm.js";
import * as tools from "./tools.js";

export const AGENTS = new Set(["health_qa", "report", "reminder", "nearby", "chitchat"]);

export const ROUTER_SYSTEM = `You are the ORCHESTRATOR of a health-information assistant for villagers in Uttarakhand, India.
Read the user's message and decide which specialist agents to run. Reply with ONLY one JSON object, no other text.

Agents:
- "health_qa": any question about symptoms, illness, first aid, pregnancy, child health, prevention.
- "report": the user gives medical report numbers (haemoglobin, fasting sugar, blood pressure). args: {"sex":"F|M|null","hb":number|null,"fbs":number|null,"sys":number|null,"dia":number|null}
- "reminder": the user wants a medicine reminder. args: {"medicine":"name","times":["HH:MM" in 24-hour format]}
- "nearby": the user asks where to go / nearest hospital. args: {"district":"district name or null"}
- "chitchat": greeting, thanks, or anything not about health. args: {}

JSON format:
{"language":"hi" or "en","search_query":"3-8 English keywords describing the health topic","steps":[{"agent":"...","args":{...}}]}

Rules: use several steps if the message needs several things. "language" is "hi" if the user writes Hindi (Devanagari or Roman/Hinglish), else "en". Never invent report values the user did not give.`;

export const COMPOSE_SYSTEM = `You are Pahadi Swasthya Saathi, a kind health-information assistant for villagers in Uttarakhand, India.
Write the final reply using ONLY the FACTS and CONTEXT given. Rules:
- Language: {lang_name}. Use very simple, short sentences a village elder can understand. No medical jargon.
- You give information and guidance only. NEVER diagnose, NEVER name a specific illness as the user's condition, NEVER give medicine names with doses.
- Structure for health questions: (1) a one-line summary, (2) what to do at home, (3) when to see a doctor / go to hospital. Use short bullet points.
- If the CONTEXT does not contain the answer, say you are not sure and advise meeting a doctor or ASHA worker. Do not make things up.
- If the facts say a reminder was saved, confirm the medicine and times clearly.
- If the facts list helplines or hospitals, present them clearly.
- Do not add a disclaimer yourself; the app adds it.`;

export const DISCLAIMER = {
  hi: "ℹ️ यह सिर्फ़ जानकारी है, डॉक्टर की सलाह का विकल्प नहीं। दवा लेने से पहले डॉक्टर, ASHA दीदी या फार्मासिस्ट से पूछें। आपातकाल में 108 पर कॉल करें।",
  en: "ℹ️ This is information only, not a substitute for a doctor. Ask a doctor, ASHA worker or pharmacist before taking any medicine. In an emergency call 108.",
};

export const DOSAGE_NOTE = {
  hi: "⚠️ दवा की मात्रा (डोज़) सिर्फ़ डॉक्टर या फार्मासिस्ट से पूछकर लें।",
  en: "⚠️ Ask a doctor or pharmacist for the medicine dose.",
};

export const DOSAGE_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|ml|मिग्रा|मि\.ली)\b|\d+\s?(tablet|tablets|गोली|गोलियाँ)/i;

export const HINGLISH = new Set([
  "hai", "nahi", "mujhe", "mera", "meri", "bukhar", "dard", "dawai", "kya", "kaise",
  "ho", "rahi", "raha", "hain", "karo", "aur", "se", "hum", "aap", "dawa", "pet", "sar"
]);

export function detectLang(text = "") {
  if (/[\u0900-\u097F]/.test(text)) {
    return "hi";
  }
  const words = (text.toLowerCase().match(/[a-z]+/g) || []);
  const hinglishCount = words.filter(w => HINGLISH.has(w)).length;
  return hinglishCount >= 2 ? "hi" : "en";
}

export class Orchestrator {
  constructor(llm, retriever, userId = "demo-user") {
    this.llm = llm;
    this.rag = retriever;
    this.userId = userId;
  }

  async handle(message, history = [], uiLang = "auto", phone = null) {
    const trace = [];
    const sources = [];
    const baseLang = uiLang === "auto" ? detectLang(message) : uiLang;

    // 1. Safety agent (no AI)
    const flag = tools.checkRedFlags(message);
    if (flag) {
      trace.push({
        agent: "Safety agent",
        detail: `Red flag detected (${flag}). Answered by rules, LLM skipped.`,
      });
      const text = tools.SAFETY_TEXT[flag][baseLang];
      const hotline = flag === "mind" ? "  |  Tele-MANAS 14416" : "";
      return {
        answer: `${text}\n\n📞 108 / 112${hotline}`,
        trace,
        sources,
        lang: baseLang,
      };
    }
    trace.push({ agent: "Safety agent", detail: "No red flag found." });

    // 2. Orchestrator (LLM) -> plan
    const plan = await this._plan(message);
    let lang = uiLang !== "auto" ? baseLang : (plan.language || baseLang);
    if (uiLang === "auto" && baseLang === "hi") {
      lang = "hi";
    }
    const steps = plan.steps;
    trace.push({
      agent: "Orchestrator",
      detail: "Plan: " + steps.map(s => s.agent).join(", "),
    });

    // 3. Specialist agents
    let facts = [];
    let context = [];
    for (const st of steps) {
      const fn = this[`_agent_${st.agent}`];
      if (typeof fn === "function") {
        const out = await fn.call(this, st.args || {}, message, plan, phone);
        if (out.facts) facts = facts.concat(out.facts);
        if (out.context) context = context.concat(out.context);
        if (out.sources) {
          for (const s of out.sources) sources.push(s);
        }
        trace.push({ agent: st.agent, detail: out.trace || "" });
      }
    }

    // 4. Composer (LLM)
    let answer = await this._compose(message, history, lang, facts, context);
    trace.push({
      agent: "Composer",
      detail: `Wrote answer in ${lang === "hi" ? "Hindi" : "English"} from ${facts.length} facts and ${context.length} source passages.`,
    });

    // 5. Guard
    const [guardedAnswer, note] = this._guard(answer, lang, steps);
    answer = guardedAnswer;
    if (note) {
      trace.push({ agent: "Guard", detail: note });
    }

    return { answer, trace, sources, lang };
  }

  async _plan(message) {
    const raw = await this.llm.chat(ROUTER_SYSTEM, `USER_MESSAGE:\n${message}`, true);
    const data = extractJson(raw) || {};
    const steps = [];
    if (Array.isArray(data.steps)) {
      for (const s of data.steps) {
        if (s && typeof s === "object" && AGENTS.has(s.agent)) {
          steps.push({
            agent: s.agent,
            args: (s.args && typeof s.args === "object") ? s.args : {},
          });
        }
      }
    }
    if (steps.length === 0) {
      steps.push({ agent: "health_qa", args: {} });
    }
    return {
      language: data.language,
      search_query: data.search_query || message,
      steps,
    };
  }

  async _agent_health_qa(args, message, plan, phone) {
    const query = `${plan.search_query || ""} ${message}`.trim();
    const hits = this.rag.search(query, 3);
    if (!hits || hits.length === 0) {
      return {
        facts: ["No matching passage was found in the knowledge base."],
        trace: "No sources found: will advise a doctor.",
      };
    }
    return {
      context: hits.map(h => `[${h.source} | ${h.title}]\n${h.text}`),
      sources: hits.map(h => ({ source: h.source, title: h.title, score: Math.round(h.score * 100) / 100 })),
      trace: "Retrieved: " + hits.map(h => `${h.title} (${h.score.toFixed(2)})`).join("; "),
    };
  }

  async _agent_report(args, message, plan, phone) {
    const facts = tools.interpretReport(args.sex, args.hb, args.fbs, args.sys, args.dia);
    if (!facts || facts.length === 0) {
      return {
        facts: ["The user did not give report numbers. Ask them to share haemoglobin, fasting sugar or blood pressure values."],
        trace: "No values found in message.",
      };
    }
    const hits = this.rag.search("blood pressure diabetes anaemia haemoglobin sugar", 2);
    return {
      facts,
      context: hits.map(h => h.text),
      trace: `Interpreted ${facts.length} value(s) with tools (no AI guessing).`,
    };
  }

  async _agent_reminder(args, message, plan, phone) {
    let times = args.times || [];
    if (typeof times === "string") {
      times = [times];
    }
    const rec = tools.addReminder(this.userId, args.medicine, times, phone);
    let sent = "";
    if (phone) {
      const { ok, info } = await tools.sendWhatsApp(
        phone,
        `Pahadi Swasthya Saathi: reminder saved for ${rec.medicine} at ${rec.times.join(", ")}.`
      );
      sent = ` WhatsApp: ${info}.`;
    }
    return {
      facts: [`Reminder SAVED: medicine '${rec.medicine}' at ${rec.times.join(", ")} every day.`],
      trace: `Saved reminder ${rec.id} (${rec.medicine} at ${rec.times.join(", ")}).${sent}`,
    };
  }

  async _agent_nearby(args, message, plan, phone) {
    const { hits, helplines, note } = tools.findFacilities(args.district);
    const facts = hits.map(h => `Hospital: ${h.name} (${h.type}), district ${h.district}.`);
    if (hits.length === 0) {
      facts.push("No hospital for this district is in the demo list. Tell the user to ask the ASHA worker for the nearest PHC/CHC.");
    }
    for (const h of helplines) {
      facts.push(`Helpline ${h.number}: ${h.use}.`);
    }
    if (note) facts.push(note);
    return {
      facts,
      trace: `Looked up facilities for district '${args.district || "unknown"}': ${hits.length} found.`,
    };
  }

  async _agent_chitchat(args, message, plan, phone) {
    return {
      facts: ["The user is greeting or chatting. Reply briefly and say you can help with health questions, report numbers, medicine reminders and nearby hospitals."],
      trace: "Small talk.",
    };
  }

  async _compose(message, history, lang, facts, context) {
    const langName = lang === "hi" ? "simple Hindi in Devanagari script" : "simple English";
    const recent = (history.slice(-4) || []).map(m => `${m.role || m[0]}: ${m.text || m[1]}`).join("\n");
    const userPrompt = [
      `RECENT_CHAT:\n${recent}`,
      `USER_MESSAGE:\n${message}`,
      `FACTS:\n${facts.map(f => `- ${f}`).join("\n")}`,
      `CONTEXT:\n${context.join("\n\n")}`
    ].join("\n\n");

    const systemPrompt = COMPOSE_SYSTEM.replace("{lang_name}", langName);
    const reply = await this.llm.chat(systemPrompt, userPrompt);
    return (reply || "").trim();
  }

  _guard(answer, lang, steps) {
    let note = "";
    let guarded = answer;
    if (DOSAGE_PATTERN.test(guarded)) {
      guarded += "\n\n" + DOSAGE_NOTE[lang];
      note = "Dosage-like text found in answer: added warning.";
    }
    guarded += "\n\n" + DISCLAIMER[lang];
    return [guarded, note];
  }
}
