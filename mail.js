/**
 * OmniTender Mail — Superhuman-style workflow client
 * Methodology: inbox = todo list, E = done, H = remind, J/K navigate, Ctrl+K command palette
 */
(function () {
  function defaultApiBase() {
    if (window.location.protocol === "file:") {
      return localStorage.getItem("omnitender_mail_api") || "http://localhost:8090";
    }
    const host = window.location.hostname;
    if (host.includes("omnitender-crm") && host.includes("fly.dev")) {
      return window.location.origin;
    }
    if (host.endsWith("omnitender.us") || host === "localhost" || host === "127.0.0.1") {
      return localStorage.getItem("omnitender_mail_api") || "https://omnitender-crm.fly.dev";
    }
    if (host.includes("fly.dev") || window.location.port === "8090") {
      return window.location.origin;
    }
    return localStorage.getItem("omnitender_mail_api") || "http://localhost:8090";
  }

  const DEFAULT_API = defaultApiBase();

  const state = {
    apiBase: DEFAULT_API,
    apiToken: localStorage.getItem("omnitender_mail_token") || "dev-local-token",
    split: "all",
    threads: [],
    counts: {},
    selectedId: null,
    threadDetail: null,
    snippets: [],
    cmdOpen: false,
    cmdIndex: 0,
  };

  const SPLITS = [
    { key: "all", label: "Inbox" },
    { key: "important", label: "Important" },
    { key: "sales", label: "Sales" },
    { key: "support", label: "Support" },
    { key: "general", label: "General" },
    { key: "calendar", label: "Calendar" },
    { key: "other", label: "Other" },
    { key: "reminders", label: "Reminders" },
    { key: "done", label: "Done" },
  ];

  const COMMANDS = [
    { label: "Mark Done (archive)", keys: "E", action: () => actDone() },
    { label: "Remind Me", keys: "H", action: () => actRemindPrompt() },
    { label: "Remind: tomorrow (2d)", keys: "", action: () => actRemind("2d") },
    { label: "Remind: next Monday", keys: "", action: () => actRemind("mon") },
    { label: "Compose new email", keys: "C", action: () => alert("Compose from mailbox — coming soon. Use Reply for now.") },
    { label: "Search mail", keys: "/", action: () => document.getElementById("mail-search")?.focus() },
    { label: "Sync from IMAP", keys: "", action: () => syncMail() },
    { label: "Go to Done", keys: "G E", action: () => selectSplit("done") },
    { label: "Go to Reminders", keys: "G H", action: () => selectSplit("reminders") },
    { label: "Show shortcuts help", keys: "?", action: () => showShortcutHelp() },
  ];

  async function api(path, opts = {}) {
    const res = await fetch(`${state.apiBase}/api${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.apiToken}`,
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function getLeads() {
    try {
      return JSON.parse(localStorage.getItem("omnitender_leads") || "[]");
    } catch {
      return [];
    }
  }

  function matchLead(thread) {
    const leads = getLeads();
    const email = (thread.from_email || "").toLowerCase();
    return leads.find((l) => {
      const notes = (l.notes || "").toLowerCase();
      const contact = (l.contact || "").toLowerCase();
      return notes.includes(email) || contact.includes(email.split("@")[0]);
    });
  }

  async function refreshCounts() {
    try {
      const data = await api("/splits");
      state.counts = data.counts || {};
    } catch {
      state.counts = {};
    }
  }

  async function loadThreads() {
    const q = document.getElementById("mail-search")?.value?.trim();
    try {
      const data = await api(`/threads?split=${encodeURIComponent(state.split)}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      state.threads = data.threads || [];
    } catch (e) {
      console.warn("[mail]", e.message);
      state.threads = loadLocalFallback();
    }
    renderThreadList();
    renderSplitCounts();
  }

  function loadLocalFallback() {
    const raw = localStorage.getItem("omnitender_mail_threads");
    if (raw) {
      try {
        return JSON.parse(raw).filter((t) => filterLocal(t, state.split));
      } catch { /* ignore */ }
    }
    return [];
  }

  function filterLocal(t, split) {
    if (split === "all") return t.status === "inbox";
    if (split === "done") return t.status === "done";
    if (split === "reminders") return t.status === "reminder";
    return t.status === "inbox" && t.split_key === split;
  }

  async function loadThread(id) {
    state.selectedId = id;
    try {
      const data = await api(`/threads/${id}`);
      state.threadDetail = data.thread;
    } catch {
      state.threadDetail = state.threads.find((t) => t.id === id) || null;
    }
    renderThreadList();
    renderReadingPane();
  }

  async function actDone() {
    if (!state.selectedId) return;
    await api(`/threads/${state.selectedId}/done`, { method: "POST" });
    state.selectedId = null;
    state.threadDetail = null;
    await loadThreads();
    renderReadingPane();
  }

  async function actRemind(when) {
    if (!state.selectedId) return;
    await api(`/threads/${state.selectedId}/remind`, {
      method: "POST",
      body: JSON.stringify({ when }),
    });
    state.selectedId = null;
    state.threadDetail = null;
    await loadThreads();
    renderReadingPane();
  }

  function actRemindPrompt() {
    const when = prompt("Remind when? (mon, 2d, 1w, or YYYY-MM-DD)");
    if (when) actRemind(when);
  }

  async function syncMail() {
    setStatus("Syncing IMAP…");
    try {
      const data = await api("/sync", { method: "POST" });
      setStatus(`Sync complete — ${JSON.stringify(data.results)}`);
      await refreshCounts();
      await loadThreads();
    } catch (e) {
      setStatus(`Sync failed: ${e.message}`);
    }
  }

  async function sendReply() {
    const body = document.getElementById("mail-reply-body")?.value?.trim();
    if (!body || !state.threadDetail) return;
    const t = state.threadDetail;
    const lastMsg = t.messages?.[t.messages.length - 1];
    try {
      await api("/send", {
        method: "POST",
        body: JSON.stringify({
          mailboxId: t.mailbox_id,
          to: t.from_email,
          subject: t.subject.startsWith("Re:") ? t.subject : `Re: ${t.subject}`,
          body,
          threadId: t.id,
          inReplyTo: lastMsg?.message_id,
        }),
      });
      document.getElementById("mail-reply-body").value = "";
      setStatus("Sent");
      await loadThread(t.id);
    } catch (e) {
      setStatus(`Send failed: ${e.message} (configure SMTP in mail-service/.env)`);
    }
  }

  function selectSplit(key) {
    state.split = key;
    state.selectedId = null;
    state.threadDetail = null;
    document.querySelectorAll(".mail-split-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.split === key);
    });
    loadThreads();
    renderReadingPane();
  }

  function setStatus(msg) {
    const el = document.getElementById("mail-status");
    if (el) el.textContent = msg;
  }

  function renderSplitCounts() {
    const total = state.counts.total_inbox ?? state.threads.length;
    const countEl = document.getElementById("mail-inbox-count");
    if (countEl) countEl.textContent = total;

    document.querySelectorAll(".mail-split-btn .mail-split-count").forEach((el) => {
      const key = el.closest(".mail-split-btn")?.dataset.split;
      if (key === "all") el.textContent = total;
      else if (key === "done") el.textContent = state.counts.done ?? 0;
      else if (key === "reminders") el.textContent = state.counts.reminders ?? 0;
      else el.textContent = state.counts.splits?.[key] ?? 0;
    });
  }

  function renderThreadList() {
    const container = document.getElementById("mail-threads");
    if (!container) return;
    if (!state.threads.length) {
      container.innerHTML = `<div class="mail-reading-empty">Inbox zero in this split.<br><small>E = done · H = remind · Ctrl+K = commands</small></div>`;
      return;
    }
    container.innerHTML = state.threads.map((t, i) => {
      const dotClass = t.status === "reminder" ? "reminder" : (t.is_unread ? "unread" : "");
      return `
        <div class="mail-thread-row ${t.is_unread ? "unread" : ""} ${state.selectedId === t.id ? "active" : ""}"
             data-id="${escapeHtml(t.id)}" data-index="${i}">
          <div class="mail-thread-meta">
            <span><span class="mail-dot ${dotClass}"></span>${escapeHtml(t.from_name || t.from_email)}</span>
            <span>${fmtTime(t.last_message_at)}</span>
          </div>
          <div class="mail-thread-subject">${escapeHtml(t.subject)}</div>
          <div class="mail-thread-snippet">${escapeHtml(t.snippet)}</div>
        </div>`;
    }).join("");

    container.querySelectorAll(".mail-thread-row").forEach((row) => {
      row.addEventListener("click", () => loadThread(row.dataset.id));
    });
  }

  function renderReadingPane() {
    const pane = document.getElementById("mail-reading-pane");
    if (!pane) return;
    const t = state.threadDetail;
    if (!t) {
      pane.innerHTML = `<div class="mail-reading-empty">
        <div>
          <strong>OmniTender Mail</strong><br>
          Inbox is your to-do list — not unread count.<br><br>
          <kbd>E</kbd> mark done &nbsp; <kbd>H</kbd> remind &nbsp; <kbd>J</kbd>/<kbd>K</kbd> move &nbsp; <kbd>Ctrl+K</kbd> command
        </div>
      </div>`;
      return;
    }

    const lead = matchLead(t);
    const messages = t.messages || [{ from_email: t.from_email, from_name: t.from_name, body_text: t.snippet, sent_at: t.last_message_at, direction: "inbound" }];

    pane.innerHTML = `
      <div class="mail-reading-header">
        <h2>${escapeHtml(t.subject)}</h2>
        <div class="mail-reading-from">${escapeHtml(t.from_name || "")} &lt;${escapeHtml(t.from_email)}&gt; · ${escapeHtml(t.mailbox_name || t.mailbox_address || "")}</div>
        <div class="mail-reading-actions">
          <button type="button" class="mail-btn-sm primary" id="mail-act-done">Done (E)</button>
          <button type="button" class="mail-btn-sm" id="mail-act-remind">Remind (H)</button>
          ${lead ? `<span class="mail-btn-sm" style="cursor:default;border-color:var(--accent-emerald);color:var(--accent-emerald)">CRM: ${escapeHtml(lead.name)}</span>` : ""}
        </div>
      </div>
      <div class="mail-messages">
        ${messages.map((m) => `
          <div class="mail-message-block">
            <div class="mail-message-meta">${escapeHtml(m.from_name || m.from_email)} · ${fmtTime(m.sent_at)} · ${m.direction || "inbound"}</div>
            <div class="mail-message-body">${escapeHtml(m.body_text || m.snippet || "")}</div>
          </div>`).join("")}
      </div>
      <div class="mail-compose-bar">
        <textarea id="mail-reply-body" placeholder="Reply… (Ctrl+Enter to send)"></textarea>
        <button type="button" class="btn-primary" id="mail-send-reply">Send Reply</button>
      </div>`;

    document.getElementById("mail-act-done")?.addEventListener("click", actDone);
    document.getElementById("mail-act-remind")?.addEventListener("click", actRemindPrompt);
    document.getElementById("mail-send-reply")?.addEventListener("click", sendReply);
    document.getElementById("mail-reply-body")?.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") sendReply();
    });
  }

  function openCommandPalette() {
    state.cmdOpen = true;
    state.cmdIndex = 0;
    const overlay = document.getElementById("mail-cmd-overlay");
    const input = document.getElementById("mail-cmd-input");
    overlay?.classList.remove("hidden");
    if (input) { input.value = ""; input.focus(); }
    renderCommandResults("");
  }

  function closeCommandPalette() {
    state.cmdOpen = false;
    document.getElementById("mail-cmd-overlay")?.classList.add("hidden");
  }

  function renderCommandResults(filter) {
    const q = filter.toLowerCase();
    const items = COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
    const container = document.getElementById("mail-cmd-results");
    if (!container) return;
    container.innerHTML = items.map((c, i) => `
      <div class="mail-cmd-item ${i === state.cmdIndex ? "active" : ""}" data-index="${i}">
        <span>${escapeHtml(c.label)}</span>
        <span class="mail-cmd-key">${escapeHtml(c.keys || "")}</span>
      </div>`).join("");
    container.querySelectorAll(".mail-cmd-item").forEach((el) => {
      el.addEventListener("click", () => {
        const cmd = items[parseInt(el.dataset.index, 10)];
        closeCommandPalette();
        cmd?.action();
      });
    });
    state._cmdItems = items;
  }

  function runCommandAt(index) {
    const cmd = state._cmdItems?.[index];
    if (cmd) { closeCommandPalette(); cmd.action(); }
  }

  function showShortcutHelp() {
    alert(`OmniTender Mail shortcuts\n\nCtrl+K — Command palette\nE — Mark done (archive)\nH — Remind / snooze\nJ / K — Next / previous thread\n/ — Search\nCtrl+Enter — Send reply\n\nPhilosophy: inbox = to-do list. Archive when done, remind when later.`);
  }

  function moveSelection(delta) {
    if (!state.threads.length) return;
    let idx = state.threads.findIndex((t) => t.id === state.selectedId);
    if (idx < 0) idx = 0;
    else idx = Math.max(0, Math.min(state.threads.length - 1, idx + delta));
    loadThread(state.threads[idx].id);
  }

  function isMailViewActive() {
    const mailView = document.getElementById("v-mail");
    if (mailView && mailView.classList.contains("on")) return true;
    const mailSection = document.getElementById("section-mail");
    return mailSection && !mailSection.classList.contains("hidden");
  }

  function bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (!isMailViewActive()) return;

      if (state.cmdOpen) {
        if (e.key === "Escape") { closeCommandPalette(); e.preventDefault(); return; }
        if (e.key === "ArrowDown") { state.cmdIndex = Math.min((state._cmdItems?.length || 1) - 1, state.cmdIndex + 1); renderCommandResults(document.getElementById("mail-cmd-input")?.value || ""); e.preventDefault(); return; }
        if (e.key === "ArrowUp") { state.cmdIndex = Math.max(0, state.cmdIndex - 1); renderCommandResults(document.getElementById("mail-cmd-input")?.value || ""); e.preventDefault(); return; }
        if (e.key === "Enter") { runCommandAt(state.cmdIndex); e.preventDefault(); return; }
        return;
      }

      if (e.ctrlKey && e.key.toLowerCase() === "k") { openCommandPalette(); e.preventDefault(); return; }
      if (e.target.matches("input, textarea") && e.key !== "Escape") return;

      if (e.key === "e" || e.key === "E") { actDone(); e.preventDefault(); }
      if (e.key === "h" || e.key === "H") { actRemindPrompt(); e.preventDefault(); }
      if (e.key === "j" || e.key === "J") { moveSelection(1); e.preventDefault(); }
      if (e.key === "k" || e.key === "K") { moveSelection(-1); e.preventDefault(); }
      if (e.key === "/") { document.getElementById("mail-search")?.focus(); e.preventDefault(); }
    });

    document.getElementById("mail-cmd-input")?.addEventListener("input", (e) => {
      state.cmdIndex = 0;
      renderCommandResults(e.target.value);
    });
    document.getElementById("mail-cmd-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "mail-cmd-overlay") closeCommandPalette();
    });
  }

  function renderShell() {
    const section = document.getElementById("section-mail");
    if (!section || section.dataset.rendered) return;
    section.dataset.rendered = "1";

    section.innerHTML = `
      <div class="mail-app" id="mail-app">
        <aside class="mail-splits">
          <div class="mail-splits-header">
            <h3>Inbox</h3>
            <div class="mail-inbox-count" id="mail-inbox-count">—</div>
          </div>
          <div class="mail-split-list" id="mail-split-list">
            ${SPLITS.map((s) => `
              <button type="button" class="mail-split-btn ${s.key === "all" ? "active" : ""}" data-split="${s.key}">
                <span>${s.label}</span>
                <span class="mail-split-count">0</span>
              </button>`).join("")}
          </div>
          <div class="mail-mailboxes">
            <div class="mail-mailbox-chip">omnitender@omnitender.us</div>
            <div class="mail-mailbox-chip">sales@omnitender.us</div>
            <div class="mail-mailbox-chip">support@omnitender.us</div>
          </div>
        </aside>
        <div class="mail-thread-list">
          <div class="mail-thread-toolbar">
            <input type="search" class="mail-search" id="mail-search" placeholder="Search (from:, subject:)…">
            <button type="button" class="mail-btn-sm" id="mail-sync-btn">Sync</button>
          </div>
          <div class="mail-threads" id="mail-threads"></div>
          <div class="mail-shortcut-hint">
            <kbd>Ctrl+K</kbd> command · <kbd>E</kbd> done · <kbd>H</kbd> remind · <kbd>J</kbd>/<kbd>K</kbd> navigate
          </div>
        </div>
        <div class="mail-reading-pane" id="mail-reading-pane"></div>
      </div>
      <div class="mail-status-bar" id="mail-status">Connect mail-service on port 8090 or deploy to Fly.io</div>
      <div class="mail-cmd-overlay hidden" id="mail-cmd-overlay">
        <div class="mail-cmd-panel">
          <input class="mail-cmd-input" id="mail-cmd-input" placeholder="Type a command… (done, remind, sync, search)" autocomplete="off">
          <div class="mail-cmd-results" id="mail-cmd-results"></div>
        </div>
      </div>`;

    document.querySelectorAll(".mail-split-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectSplit(btn.dataset.split));
    });
    document.getElementById("mail-sync-btn")?.addEventListener("click", syncMail);
    document.getElementById("mail-search")?.addEventListener("input", () => loadThreads());
    bindKeyboard();
  }

  window.OmniTenderMail = {
    init() {
      state.apiBase = localStorage.getItem("omnitender_mail_api") || defaultApiBase();
      state.apiToken = localStorage.getItem("omnitender_mail_token")
        || ((window.location.hostname.includes("fly.dev") || window.location.hostname.endsWith("omnitender.us"))
          ? "omnitender-preview-2026" : "dev-local-token");
      renderShell();
      refreshCounts().then(loadThreads).catch((err) => {
        const bar = document.getElementById("mail-status");
        if (bar) bar.textContent = "Mail API unreachable: " + err.message;
      });
      renderReadingPane();
    },
    refresh: loadThreads,
  };
})();
