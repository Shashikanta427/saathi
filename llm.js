/**
 * LLM layer. Factory function getLLM() returns a model object with .chat(system, user, jsonMode).
 * Providers: Google Gemini, IBM watsonx.ai, or a Mock (no key, for testing the flow).
 */
import dotenv from "dotenv";
dotenv.config();

export class BaseLLM {
  constructor() {
    this.name = "base";
    this.isMock = false;
  }

  async chat(system, user, jsonMode = false) {
    throw new Error("Not implemented");
  }
}

export class GeminiLLM extends BaseLLM {
  constructor() {
    super();
    this.apiKey = (process.env.GEMINI_API_KEY || "").trim();

    // Default to the active, high-availability model
    let model = (process.env.GEMINI_MODEL || "gemini-flash-lite-latest").trim();
    if (
      model === "gemini-2.5-flash" ||
      model === "gemini-2.0-flash" ||
      model === "gemini-1.5-flash" ||
      !model
    ) {
      model = "gemini-flash-lite-latest";
    }
    this.modelId = model;
    this.name = `Google Gemini (${this.modelId})`;
    this.client = null;
  }

  async _getClient() {
    if (!this.client) {
      const { GoogleGenAI } = await import("@google/genai");
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async chat(system, user, jsonMode = false) {
    const ai = await this._getClient();
    const config = {
      systemInstruction: system,
      temperature: 0.2,
    };
    if (jsonMode) {
      config.responseMimeType = "application/json";
    }

    // Try primary working models in order of stability and quota availability
    const candidateModels = [
      this.modelId,
      "gemini-flash-lite-latest",
      "gemini-3.1-flash-lite",
      "gemini-3-flash-preview",
      "gemini-flash-latest",
    ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

    let lastError = null;
    for (const m of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: user,
          config,
        });
        return response.text || "";
      } catch (err) {
        lastError = err;
        console.warn(`Gemini generation on model '${m}' failed:`, err.message || err);
      }
    }

    throw lastError;
  }
}

export class WatsonxLLM extends BaseLLM {
  constructor() {
    super();
    this.apiKey = (process.env.WATSONX_APIKEY || "").trim();
    this.projectId = (process.env.WATSONX_PROJECT_ID || "").trim();
    this.baseUrl = (process.env.WATSONX_URL || "https://us-south.ml.cloud.ibm.com").replace(/\/$/, "");
    this.modelId = (process.env.WATSONX_MODEL_ID || "ibm/granite-3-3-8b-instruct").trim();
    this.name = `IBM watsonx.ai (${this.modelId})`;
    this.token = null;
    this.tokenExpiry = 0;
  }

  async _getIamToken() {
    if (this.token && Date.now() < this.tokenExpiry - 60000) {
      return this.token;
    }
    const params = new URLSearchParams({
      grant_type: "urn:ibm:params:oauth:grant-type:apikey",
      apikey: this.apiKey,
    });
    const res = await fetch("https://iam.cloud.ibm.com/identity/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`IBM IAM authentication failed: ${res.statusText}`);
    }
    const data = await res.json();
    this.token = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return this.token;
  }

  async chat(system, user, jsonMode = false) {
    const token = await this._getIamToken();
    const url = `${this.baseUrl}/ml/v1/text/chat?version=2023-05-29`;
    const payload = {
      model_id: this.modelId,
      project_id: this.projectId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      parameters: {
        temperature: 0.2,
        max_new_tokens: 900,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Watsonx API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  }
}

export class MockLLM extends BaseLLM {
  constructor() {
    super();
    this.name = "MOCK (no API key: rule-based, not real AI)";
    this.isMock = true;
  }

  async chat(system, user, jsonMode = false) {
    if (jsonMode) {
      const msg = (user.split("USER_MESSAGE:")[1] || user).toLowerCase();
      let agent;
      if (["remind", "yaad", "रिमाइंडर", "याद"].some(k => msg.includes(k))) {
        agent = { agent: "reminder", args: { medicine: "medicine", times: ["08:00"] } };
      } else if (["hospital", "अस्पताल", "phc", "doctor kahan", "nearby"].some(k => msg.includes(k))) {
        agent = { agent: "nearby", args: { district: "Dehradun" } };
      } else if (["hb", "hemoglobin", "sugar", "bp", "report"].some(k => msg.includes(k))) {
        agent = { agent: "report", args: {} };
      } else {
        agent = { agent: "health_qa", args: {} };
      }
      return JSON.stringify({
        language: "hi",
        search_query: msg.trim(),
        steps: [agent],
      });
    }

    const facts = (user.split("FACTS:")[1] || "").split("CONTEXT:")[0].trim();
    const ctx = (user.split("CONTEXT:")[1] || "").trim().slice(0, 700);
    return `(Mock mode) ${facts}\n\n${ctx}`;
  }
}

export function getLLM() {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (forced === "mock") {
    return new MockLLM();
  }
  if (forced === "watsonx" || (!forced && process.env.WATSONX_APIKEY && process.env.WATSONX_PROJECT_ID)) {
    return new WatsonxLLM();
  }
  if (forced === "gemini" || (!forced && process.env.GEMINI_API_KEY)) {
    return new GeminiLLM();
  }
  return new MockLLM();
}

export function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
