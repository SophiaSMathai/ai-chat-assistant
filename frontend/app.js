/**
 * app.js
 * ------
 * All client-side behavior for the Nova chat UI:
 *  - auto-resizing textarea + char counter
 *  - sending messages to the FastAPI backend and rendering replies
 *  - typing indicator while waiting on the AI
 *  - Markdown rendering (marked.js) + sanitization (DOMPurify)
 *  - copy-to-clipboard on AI bubbles
 *  - dark/light theme toggle
 *  - mobile sidebar drawer
 *
 * No build step, no frameworks — just the DOM.
 */

(() => {
  "use strict";

  // ---------- Config ----------
  // Point this at your deployed backend, e.g. "https://my-api.onrender.com"
  const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : "https://ai-chat-assistant-9c9i.onrender.com";
  const MAX_CHARS = 4000;

  // ---------- State ----------
  let sessionId = localStorage.getItem("nova_session_id") || null;
  let isSending = false;

  // ---------- Element refs ----------
  const $ = (sel) => document.querySelector(sel);

  const messagesEl = $("#messages");
  const emptyStateEl = $("#emptyState");
  const inputEl = $("#messageInput");
  const sendBtn = $("#sendBtn");
  const charCounterEl = $("#charCounter");
  const clearChatBtn = $("#clearChatBtn");
  const themeToggleBtn = $("#themeToggle");
  const themeLabelEl = $("#themeLabel");
  const sidebarEl = $("#sidebar");
  const overlayEl = $("#overlay");
  const openSidebarBtn = $("#openSidebar");
  const closeSidebarBtn = $("#closeSidebar");
  const newChatBtn = $("#newChatBtn");
  const messageTemplate = $("#messageTemplate");
  const typingTemplate = $("#typingTemplate");

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    themeLabelEl.textContent = theme === "dark" ? "Dark mode" : "Light mode";
    localStorage.setItem("nova_theme", theme);
  }

  function initTheme() {
    const saved = localStorage.getItem("nova_theme");
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(saved || (prefersLight ? "light" : "dark"));
  }

  themeToggleBtn.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  // ---------- Sidebar (mobile drawer) ----------
  function openSidebar() {
    sidebarEl.classList.add("sidebar--open");
    overlayEl.classList.add("overlay--visible");
  }
  function closeSidebar() {
    sidebarEl.classList.remove("sidebar--open");
    overlayEl.classList.remove("overlay--visible");
  }
  openSidebarBtn.addEventListener("click", openSidebar);
  closeSidebarBtn.addEventListener("click", closeSidebar);
  overlayEl.addEventListener("click", closeSidebar);

  // ---------- Composer: auto-resize + char counter ----------
  function autoResize() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px";
  }

  function updateCharCounter() {
    const len = inputEl.value.length;
    charCounterEl.textContent = `${len} / ${MAX_CHARS}`;
    charCounterEl.classList.toggle("char-counter--warn", len > MAX_CHARS * 0.9);
  }

  function updateSendState() {
    const hasText = inputEl.value.trim().length > 0;
    sendBtn.disabled = !hasText || isSending;
  }

  inputEl.addEventListener("input", () => {
    autoResize();
    updateCharCounter();
    updateSendState();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // ---------- Suggestion cards ----------
  document.querySelectorAll(".suggestion-card").forEach((card) => {
    card.addEventListener("click", () => {
      inputEl.value = card.dataset.prompt || "";
      autoResize();
      updateCharCounter();
      updateSendState();
      inputEl.focus();
    });
  });

  // ---------- Rendering helpers ----------
  function hideEmptyState() {
    if (emptyStateEl) emptyStateEl.style.display = "none";
  }

  function renderMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      const raw = window.marked.parse(text, { breaks: true });
      return window.DOMPurify.sanitize(raw);
    }
    // Fallback: escape HTML and preserve line breaks if the CDN scripts failed to load
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
  }

  function appendMessage(role, text) {
    hideEmptyState();

    const node = messageTemplate.content.cloneNode(true);
    const messageEl = node.querySelector(".message");
    const avatarEl = node.querySelector(".message__avatar");
    const bubbleEl = node.querySelector(".message__bubble");
    const copyBtn = node.querySelector(".copy-btn");

    messageEl.classList.add(role === "user" ? "message--user" : "message--ai");
    avatarEl.textContent = role === "user" ? "You".slice(0, 1) : "N";
    if (role === "ai") avatarEl.classList.add("message__avatar--ai");

    bubbleEl.innerHTML = renderMarkdown(text);

    copyBtn.addEventListener("click", () => copyMessageText(text, copyBtn));

    messagesEl.appendChild(node);
    scrollToBottom();
    return bubbleEl;
  }

  function copyMessageText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const copyIcon = btn.querySelector(".copy-btn__icon-copy");
      const checkIcon = btn.querySelector(".copy-btn__icon-check");
      copyIcon.style.display = "none";
      checkIcon.style.display = "inline-block";
      setTimeout(() => {
        copyIcon.style.display = "inline-block";
        checkIcon.style.display = "none";
      }, 1500);
    });
  }

  function showTypingIndicator() {
    const node = typingTemplate.content.cloneNode(true);
    const el = node.querySelector(".message--typing");
    messagesEl.appendChild(node);
    scrollToBottom();
    return el;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendErrorNotice(message) {
    hideEmptyState();
    const node = messageTemplate.content.cloneNode(true);
    const messageEl = node.querySelector(".message");
    const avatarEl = node.querySelector(".message__avatar");
    const bubbleEl = node.querySelector(".message__bubble");
    const actionsEl = node.querySelector(".message__actions");

    messageEl.classList.add("message--ai");
    avatarEl.textContent = "!";
    avatarEl.classList.add("message__avatar--ai");
    bubbleEl.style.color = "#f2545b";
    bubbleEl.textContent = message;
    actionsEl.remove();

    messagesEl.appendChild(node);
    scrollToBottom();
  }

  // ---------- Sending messages ----------
  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text || isSending) return;

    isSending = true;
    updateSendState();

    appendMessage("user", text);
    inputEl.value = "";
    autoResize();
    updateCharCounter();

    const typingEl = showTypingIndicator();

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      const data = await response.json();

      typingEl.remove();

      if (!response.ok) {
        appendErrorNotice(data.error || "Something went wrong. Please try again.");
        return;
      }

      sessionId = data.session_id;
      localStorage.setItem("nova_session_id", sessionId);
      appendMessage("ai", data.reply);
    } catch (err) {
      typingEl.remove();
      appendErrorNotice(
        "Couldn't reach the server. Check your connection and that the backend is running."
      );
    } finally {
      isSending = false;
      updateSendState();
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", handleSend);

  // ---------- Clear chat ----------
  async function handleClearChat() {
    messagesEl.querySelectorAll(".message").forEach((el) => el.remove());
    if (emptyStateEl) emptyStateEl.style.display = "";

    if (sessionId) {
      try {
        await fetch(`${API_BASE_URL}/api/clear`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
      } catch (err) {
        // Non-fatal — the frontend has already cleared visually.
        console.warn("Failed to clear server-side session:", err);
      }
    }
  }

  clearChatBtn.addEventListener("click", handleClearChat);
  newChatBtn.addEventListener("click", () => {
    handleClearChat();
    sessionId = null;
    localStorage.removeItem("nova_session_id");
    closeSidebar();
  });

  // ---------- Voice input mockup ----------
  $("#voiceBtn").addEventListener("click", () => {
    $("#voiceBtn").classList.toggle("chip-btn--active");
    inputEl.placeholder = $("#voiceBtn").classList.contains("chip-btn--active")
      ? "Listening... (mockup, no audio captured)"
      : "Message Nova...";
  });

  // ---------- Init ----------
  initTheme();
  updateCharCounter();
  updateSendState();
})();
