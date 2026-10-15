import fs from "fs";
import path from "path";
import assert from "assert";
import * as tools from "../tools.js";
import { Orchestrator } from "../agents.js";
import { Retriever } from "../rag.js";
import { BaseLLM, MockLLM } from "../llm.js";

class FakeLLM extends BaseLLM {
  constructor(plan) {
    super();
    this.name = "fake";
    this.plan = plan;
    this.calls = [];
  }

  async chat(system, user, jsonMode = false) {
    this.calls.push(jsonMode ? "router" : "compose");
    return jsonMode
      ? "```json\n" + JSON.stringify(this.plan) + "\n```"
      : "FINAL ANSWER take 500 mg now";
  }
}

const TEST_REMINDERS = "/tmp/test_reminders.json";
tools.setReminderFile(TEST_REMINDERS);
if (fs.existsSync(TEST_REMINDERS)) {
  fs.unlinkSync(TEST_REMINDERS);
}

const rag = new Retriever();

async function runTests() {
  console.log("🧪 Starting test suite...\n");

  // 1. Safety path never calls the LLM
  let llm = new FakeLLM({ steps: [] });
  let r = await new Orchestrator(llm, rag).handle("mujhe seene mein dard ho raha hai");
  assert.strictEqual(llm.calls.length, 0, "LLM should not be called on emergency");
  assert(r.answer.includes("108"), "Answer must contain 108");
  console.log("✅ PASS: safety skips LLM");

  // 2. Multi-step plan: reminder + health_qa, handles ```json fences
  llm = new FakeLLM({
    language: "hi",
    search_query: "fever",
    steps: [
      { agent: "health_qa", args: {} },
      { agent: "reminder", args: { medicine: "BP tablet", times: ["08:00", "20:30"] } },
    ],
  });
  r = await new Orchestrator(llm, rag).handle("mujhe bukhar hai aur BP ki goli ka reminder lagao");
  const remList = tools.listReminders("demo-user");
  assert.deepStrictEqual(remList[0].times, ["08:00", "20:30"], "Reminder times match");
  assert(r.answer.toLowerCase().includes("dose") || r.answer.includes("डोज़"), "Dosage guard fired");
  assert(r.trace.some(t => t.agent === "reminder"), "Reminder agent was traced");
  console.log("✅ PASS: multi-agent plan + reminder saved + dosage guard");

  // 3. Report agent uses tools
  llm = new FakeLLM({
    language: "en",
    search_query: "anaemia",
    steps: [
      { agent: "report", args: { sex: "F", hb: 9.2, fbs: 128, sys: 150, dia: 95 } },
    ],
  });
  r = await new Orchestrator(llm, rag).handle("my Hb 9.2 sugar 128 BP 150/95");
  const facts = tools.interpretReport("F", 9.2, 128, 150, 95);
  assert(facts[0].includes("LOW"), "Hb should be LOW");
  assert(facts[1].includes("diabetes range"), "Sugar should be diabetes range");
  assert(facts[2].includes("HIGH"), "BP should be HIGH");
  console.log("✅ PASS: report tool");

  // 4. Garbage from the LLM falls back to health_qa
  class BadLLM extends FakeLLM {
    async chat(s, u, jsonMode = false) {
      return jsonMode ? "sorry I cannot" : "ok answer";
    }
  }
  r = await new Orchestrator(new BadLLM({}), rag).handle("pet mein dard hai");
  assert.strictEqual(r.trace[1].detail, "Plan: health_qa", "Fallback should default to health_qa");
  console.log("✅ PASS: fallback on bad JSON");

  // 5. RAG retrieval sanity (Hindi + Hinglish + English)
  const retrievalTests = [
    ["दस्त और उल्टी में क्या करें", "diarrhoea"],
    ["khansi 3 hafte se hai", "cough"],
    ["snake bite what to do", "hills"],
    ["pregnant woman bleeding", "mother"],
  ];
  for (const [q, expect] of retrievalTests) {
    const top = rag.search(q, 1);
    console.log("   Query:", q, "->", top[0]?.source);
    assert(top && top[0] && top[0].source.includes(expect), `Failed retrieval test for query: ${q}`);
  }
  console.log("✅ PASS: retrieval");

  // 6. Mock mode end-to-end (no key)
  r = await new Orchestrator(new MockLLM(), rag).handle("fever kya karun");
  assert(r.answer && r.answer.length > 0, "Mock mode returned non-empty answer");
  console.log("✅ PASS: mock mode");

  console.log("\n🎉 ALL 6 TESTS PASSED SUCCESSFULLY!");
}

runTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
