# Pahadi Swasthya Saathi: Gen AI + Agentic AI health companion (JavaScript / Node.js)

Hindi/English health-information assistant for Uttarakhand villages.
- **Gen AI** = an LLM (Google Gemini or IBM watsonx.ai Granite) writes the answers.
- **Agentic AI** = an Orchestrator agent plans the work, and specialist agents use tools to do it.

---

## Kaise kaam karta hai (How it works)

```
User message
   |
   v
[1] Safety agent  (rules, no AI)  --- red flag? --> 108 / Tele-MANAS message, STOP
   |
   v
[2] Orchestrator  (LLM)  -> JSON plan: which agents to run + arguments
   |
   +--> health_qa : RAG search in knowledge/ folder (TF-IDF char n-grams)
   +--> report    : JS tool checks Hb / sugar / BP against normal ranges
   +--> reminder  : JS tool saves reminder (data/reminders.json), optional WhatsApp via Twilio
   +--> nearby    : JS tool looks up hospitals + helplines (data/facilities.json)
   +--> chitchat
   |
   v
[3] Composer (LLM)  -> one simple answer using ONLY the facts + retrieved text
   |
   v
[4] Guard (rules)   -> blocks dosage advice, adds disclaimer + 108 note
```

The app shows an **"agent trace"** (`🧠 How Saathi worked (agent trace)`) under every answer, showing step-by-step how each agent processed the request.

---

## How to Run This Project (JavaScript / Node.js)

### 1. Prerequisites
- **Node.js** (v18 or newer, v20+ recommended). Check with:
  ```bash
  node -v
  npm -v
  ```

### 2. Install Dependencies
Open your terminal in the project directory and run:
```bash
npm install
```

### 3. Setup API Keys (`.env`)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` and add your preferred key (Gemini or Watsonx).

#### Option A: Google Gemini (Recommended - Free & excellent Hindi)
1. Get a free API key at [Google AI Studio](https://aistudio.google.com).
2. Set in `.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```

#### Option B: IBM watsonx.ai
1. Create a project at [cloud.ibm.com](https://cloud.ibm.com).
2. Set in `.env`:
   ```env
   WATSONX_APIKEY=your_ibm_api_key
   WATSONX_PROJECT_ID=your_project_id
   WATSONX_URL=https://us-south.ml.cloud.ibm.com
   WATSONX_MODEL_ID=ibm/granite-3-3-8b-instruct
   ```

#### Option C: MOCK mode (No key needed)
If no key is configured in `.env`, the app automatically runs in **MOCK mode** (rule-based responses, offline demonstration).

---

### 4. Start the Application
To launch the web interface:
```bash
npm start
```
Open your browser and navigate to:
👉 **[http://localhost:8501](http://localhost:8501)**

For live code auto-reloading during development:
```bash
npm run dev
```

---

### 5. Run the Automated Tests
To verify all agents, RAG retrieval, report interpreter, and safety guards:
```bash
npm test
```
All 6 tests (Safety, Multi-agent plan, Report tool, Bad-JSON fallback, RAG retrieval, Mock mode) will run and output results.

---

### 6. Run the Reminder Scheduler (Optional)
To run the automated background reminder service (which sends WhatsApp alerts via Twilio at scheduled times):
```bash
npm run scheduler
```

---

## Project Structure (JavaScript)

| File / Folder | Role & Description |
|---|---|
| [`server.js`](file:///Users/karankumar/Desktop/saathi/server.js) | Express web server & REST API (`/api/chat`, `/api/status`, `/api/reminders`) |
| [`public/`](file:///Users/karankumar/Desktop/saathi/public) | Modern, responsive web frontend (HTML, CSS, JS) with live Agent Trace |
| [`agents.js`](file:///Users/karankumar/Desktop/saathi/agents.js) | Orchestrator, specialist agents (`health_qa`, `report`, `reminder`, `nearby`, `chitchat`), Composer, and Guard |
| [`llm.js`](file:///Users/karankumar/Desktop/saathi/llm.js) | Unified LLM interface for Google Gemini (`@google/genai`), IBM watsonx, and Mock |
| [`rag.js`](file:///Users/karankumar/Desktop/saathi/rag.js) | In-memory TF-IDF retriever with char n-grams supporting Hindi, Hinglish & English |
| [`tools.js`](file:///Users/karankumar/Desktop/saathi/tools.js) | Safety red flags, report interpreter, reminder persistence, nearby care, WhatsApp sender |
| [`scheduler.js`](file:///Users/karankumar/Desktop/saathi/scheduler.js) | Background job checking and triggering medicine reminders |
| [`tests/test_flow.js`](file:///Users/karankumar/Desktop/saathi/tests/test_flow.js) | Automated test suite verifying the end-to-end agentic workflow |
| [`knowledge/`](file:///Users/karankumar/Desktop/saathi/knowledge) | Curated medical & first-aid reference documents (RAG corpus) |
| [`data/facilities.json`](file:///Users/karankumar/Desktop/saathi/data/facilities.json) | Uttarakhand hospital and emergency helpline directory |
| [`data/reminders.json`](file:///Users/karankumar/Desktop/saathi/data/reminders.json) | Local storage for scheduled medicine reminders |

---

## Important Notice
- This application is an educational prototype and health-information assistant, **not a diagnostic medical device**.
- In case of emergency or severe symptoms, users should immediately contact **108** (Ambulance), **104** (Health Advice), or **14416** (Tele-MANAS).
