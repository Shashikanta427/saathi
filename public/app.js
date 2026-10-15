/**
 * Pahadi Swasthya Saathi - Frontend Logic
 */
document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const messagesContainer = document.getElementById("messages-container");
  const welcomeCard = document.getElementById("welcome-card");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const modelBadge = document.getElementById("model-badge");
  const modelName = document.getElementById("model-name");
  const phoneInput = document.getElementById("phone-input");
  const savePhoneBtn = document.getElementById("save-phone-btn");
  const remindersList = document.getElementById("reminders-list");
  const reminderCount = document.getElementById("reminder-count");
  const clearChatBtn = document.getElementById("clear-chat-btn");
  const openSidebarBtn = document.getElementById("open-sidebar-btn");
  const closeSidebarBtn = document.getElementById("close-sidebar-btn");
  const sidebar = document.getElementById("sidebar");

  let currentLang = "auto";
  let history = []; // [{ role: "user" | "assistant", text: "..." }]

  // Restore saved phone
  const savedPhone = localStorage.getItem("saathi_phone");
  if (savedPhone) {
    phoneInput.value = savedPhone;
  }

  savePhoneBtn.addEventListener("click", () => {
    const val = phoneInput.value.trim();
    if (val) {
      localStorage.setItem("saathi_phone", val);
      alert("WhatsApp number saved: " + val);
    } else {
      localStorage.removeItem("saathi_phone");
      alert("WhatsApp number cleared");
    }
  });

  // Mobile sidebar toggle
  if (openSidebarBtn && closeSidebarBtn && sidebar) {
    openSidebarBtn.addEventListener("click", () => sidebar.classList.add("open"));
    closeSidebarBtn.addEventListener("click", () => sidebar.classList.remove("open"));
  }

  // Language buttons
  const langBtns = document.querySelectorAll(".seg-btn");
  langBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      langBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentLang = btn.getAttribute("data-lang");
    });
  });

  // Auto-resize textarea
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });

  // Enter to send (Shift+Enter for newline)
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event("submit"));
    }
  });

  // Example chip clicks
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const query = chip.getAttribute("data-query");
      chatInput.value = query;
      chatInput.focus();
      chatForm.dispatchEvent(new Event("submit"));
    });
  });

  // Clear Chat
  clearChatBtn.addEventListener("click", () => {
    if (confirm("Clear conversation history?")) {
      history = [];
      messagesContainer.innerHTML = "";
      if (welcomeCard) {
        messagesContainer.appendChild(welcomeCard);
      }
    }
  });

  // Load Status & Reminders
  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data.modelName) {
        modelName.textContent = data.modelName;
        modelBadge.className = data.isMock ? "status-badge mock" : "status-badge live";
      }
      renderReminders(data.reminders || []);
    } catch (err) {
      console.error("Failed to load status:", err);
      modelName.textContent = "Offline / Connection Error";
    }
  }

  function renderReminders(reminders) {
    reminderCount.textContent = reminders.length;
    if (reminders.length === 0) {
      remindersList.innerHTML = `
        <div class="empty-state">
          No reminders yet.<br>Try saying: <em>"Remind me to take my BP tablet at 8 am and 8 pm"</em>
        </div>
      `;
      return;
    }

    remindersList.innerHTML = reminders.map(r => `
      <div class="reminder-card" data-id="${r.id}">
        <div class="reminder-info">
          <span class="reminder-med">💊 ${escapeHtml(r.medicine)}</span>
          <span class="reminder-times">⏰ ${(r.times || []).join(", ")}</span>
        </div>
        <button class="delete-rem-btn" data-id="${r.id}" title="Delete reminder">✕</button>
      </div>
    `).join("");

    remindersList.querySelectorAll(".delete-rem-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const id = btn.getAttribute("data-id");
        if (confirm("Delete this reminder?")) {
          await deleteReminder(id);
        }
      });
    });
  }

  async function deleteReminder(id) {
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: "DELETE" });
      const data = await res.json();
      renderReminders(data.reminders || []);
    } catch (err) {
      console.error("Delete reminder failed:", err);
    }
  }

  async function refreshReminders() {
    try {
      const res = await fetch("/api/reminders");
      const data = await res.json();
      renderReminders(data.reminders || []);
    } catch (err) {
      console.error("Failed to refresh reminders:", err);
    }
  }

  // Chat Submission
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = chatInput.value.trim();
    if (!query) return;

    if (welcomeCard && welcomeCard.parentNode) {
      welcomeCard.remove();
    }

    // Add user message
    appendMessage("user", query);
    chatInput.value = "";
    chatInput.style.height = "auto";
    sendBtn.disabled = true;

    // Add loading indicator
    const loadingElem = appendLoading();
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          history: history.slice(-6),
          uiLang: currentLang,
          phone: phoneInput.value.trim() || null,
        }),
      });

      const data = await res.json();
      loadingElem.remove();

      appendMessage("assistant", data.answer, data.trace, data.sources);
      history.push({ role: "user", text: query });
      history.push({ role: "assistant", text: data.answer });

      // If reminder was mentioned or used, refresh list
      if (data.trace && data.trace.some(t => t.agent === "reminder")) {
        await refreshReminders();
      }
    } catch (err) {
      loadingElem.remove();
      appendMessage("assistant", "Sorry, a network error occurred. For emergencies please call 108 immediately.", [], []);
    } finally {
      sendBtn.disabled = false;
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  });

  function appendMessage(role, text, trace = [], sources = []) {
    const row = document.createElement("div");
    row.className = `message-row ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "user" ? "🧑" : "🏔️";

    const body = document.createElement("div");
    body.className = "message-body";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerHTML = formatMarkdown(text);
    body.appendChild(bubble);

    // If assistant with trace, add trace accordion
    if (role === "assistant" && trace && trace.length > 0) {
      const traceCard = document.createElement("details");
      traceCard.className = "trace-accordion";

      const summary = document.createElement("summary");
      summary.className = "trace-summary";
      summary.innerHTML = "<span>🧠 How Saathi worked (agent trace)</span> <span>▾</span>";
      traceCard.appendChild(summary);

      const content = document.createElement("div");
      content.className = "trace-content";

      trace.forEach(t => {
        const step = document.createElement("div");
        step.className = "trace-step";

        const tag = document.createElement("span");
        const cleanName = t.agent.toLowerCase().replace(/\s+/g, "-");
        tag.className = `agent-tag ${cleanName}`;
        tag.textContent = t.agent;

        const detail = document.createElement("span");
        detail.className = "trace-detail";
        detail.textContent = t.detail;

        step.appendChild(tag);
        step.appendChild(detail);
        content.appendChild(step);
      });

      if (sources && sources.length > 0) {
        const srcBox = document.createElement("div");
        srcBox.className = "sources-box";
        srcBox.innerHTML = `
          <div class="sources-title">Sources used:</div>
          <div class="sources-pills">
            ${sources.map(s => `<span class="source-pill">📄 ${escapeHtml(s.title)} (${escapeHtml(s.source)})</span>`).join("")}
          </div>
        `;
        content.appendChild(srcBox);
      }

      traceCard.appendChild(content);
      body.appendChild(traceCard);
    }

    row.appendChild(avatar);
    row.appendChild(body);
    messagesContainer.appendChild(row);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function appendLoading() {
    const row = document.createElement("div");
    row.className = "message-row assistant";
    row.id = "active-loading";

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "🏔️";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble typing-indicator";
    bubble.innerHTML = `
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    `;

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesContainer.appendChild(row);
    return row;
  }

  function formatMarkdown(str) {
    if (!str) return "";
    let html = escapeHtml(str);

    // Bold **text**
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    // Bullet points
    html = html.replace(/^-\s+(.+)$/gm, "• $1");

    // URLs to links
    html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

    // Phone numbers to call links
    html = html.replace(/\b(108|104|112|14416)\b/g, '<a href="tel:$1" style="color: #dc2626; font-weight: bold;">$1</a>');

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  // Initial load
  loadStatus();
});
