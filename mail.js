/**
 * OmniTender Mail — per-employee inbox with customizable shortcuts + mobile touch
 */
(function () {
  function getDashToken() {
    try { return sessionStorage.getItem('omni_dash_token') || ''; } catch (_) { return ''; }
  }
  function getDashUsername() {
    try { return sessionStorage.getItem('omni_dash_username') || ''; } catch (_) { return ''; }
  }
  function employeeMailAddress() {
    const user = String(getDashUsername() || '').trim();
    if (!user || user === 'admin') return 'you@omnitender.us';
    if (user.includes('@')) return user;
    return user + '@omnitender.us';
  }
  function personalizeMailIntro() {
    const intro = document.getElementById('mail-view-intro');
    if (!intro) return;
    const addr = employeeMailAddress();
    const who = getDashUsername() || 'you';
    intro.textContent = 'Your OmniTender inbox at ' + addr + ' — signed in as ' + who + '. Same session as the rest of this console; splits and shortcuts are saved to your account.';
  }

  function defaultApiBase() {
    if (window.location.protocol === 'file:') {
      return localStorage.getItem('omnitender_mail_api') || 'http://localhost:8090';
    }
    const host = window.location.hostname;
    if (host === 'omnitender-omniverse.fly.dev' || window.location.port === '3000') return window.location.origin;
    if (host.endsWith('omnitender.us') || host === 'localhost' || host === '127.0.0.1') {
      return localStorage.getItem('omnitender_mail_api') || 'https://omnitender-omniverse.fly.dev';
    }
    if (host.includes('omnitender-crm') && host.includes('fly.dev')) return window.location.origin;
    if (window.location.port === '8090') return window.location.origin;
    return localStorage.getItem('omnitender_mail_api') || 'http://localhost:8090';
  }

  const DEFAULT_API = defaultApiBase();
  const CHORD_TIMEOUT_MS = 900;
  const SWIPE_THRESHOLD = 56;

  const state = {
    apiBase: DEFAULT_API,
    apiToken: '',
    split: 'all',
    threads: [],
    counts: {},
    selectedId: null,
    threadDetail: null,
    cmdOpen: false,
    cmdIndex: 0,
    mobileView: 'list',
    prefs: { shortcuts: {}, touch: { swipeRight: 'markDone', swipeLeft: 'remind', showTouchBar: true }, actions: [] },
    chordBuffer: '',
    chordTimer: null,
    settingsOpen: false,
    recordingActionId: null,
    remindOpen: false,
    _cmdItems: [],
  };

  const SPLITS = [
    { key: 'all', label: 'Inbox' },
    { key: 'important', label: 'Important' },
    { key: 'sales', label: 'Sales' },
    { key: 'support', label: 'Support' },
    { key: 'general', label: 'General' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'other', label: 'Other' },
    { key: 'reminders', label: 'Reminders' },
    { key: 'done', label: 'Done' },
  ];

  const REMIND_PRESETS = [
    { label: 'Tomorrow', when: '2d' },
    { label: 'Monday', when: 'mon' },
    { label: 'In 1 week', when: '1w' },
    { label: 'In 2 weeks', when: '2w' },
  ];

  function isTouchDevice() {
    return window.matchMedia('(max-width: 900px)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
  }

  function localPrefsKey() {
    return 'omnitender_mail_prefs_' + getDashUsername();
  }

  function loadLocalPrefs() {
    try {
      const raw = localStorage.getItem(localPrefsKey());
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveLocalPrefs() {
    try {
      localStorage.setItem(localPrefsKey(), JSON.stringify({
        shortcuts: state.prefs.shortcuts,
        touch: state.prefs.touch,
      }));
    } catch { /* ignore quota */ }
  }

  async function loadPreferences() {
    const local = loadLocalPrefs();
    if (local) {
      state.prefs.shortcuts = { ...state.prefs.shortcuts, ...(local.shortcuts || {}) };
      state.prefs.touch = { ...state.prefs.touch, ...(local.touch || {}) };
    }
    try {
      const data = await api('/mail/preferences');
      if (data.shortcuts) state.prefs.shortcuts = data.shortcuts;
      if (data.touch) state.prefs.touch = data.touch;
      if (data.actions) state.prefs.actions = data.actions;
      saveLocalPrefs();
    } catch {
      /* offline / demo — local defaults only */
    }
  }

  async function savePreferences(partial) {
    if (partial.shortcuts) state.prefs.shortcuts = { ...state.prefs.shortcuts, ...partial.shortcuts };
    if (partial.touch) state.prefs.touch = { ...state.prefs.touch, ...partial.touch };
    saveLocalPrefs();
    try {
      await api('/mail/preferences', { method: 'POST', body: partial });
    } catch (e) {
      setStatus('Saved locally — sync when online: ' + e.message);
    }
  }

  async function resetPreferences() {
    try {
      const data = await api('/mail/preferences/reset', { method: 'POST', body: {} });
      state.prefs.shortcuts = data.preferences?.shortcuts || {};
      state.prefs.touch = data.preferences?.touch || state.prefs.touch;
    } catch {
      state.prefs.shortcuts = {};
      state.prefs.touch = { swipeRight: 'markDone', swipeLeft: 'remind', showTouchBar: true };
    }
    localStorage.removeItem(localPrefsKey());
    saveLocalPrefs();
    renderSettingsPanel();
    updateShortcutHints();
  }

  function actionLabel(id) {
    const a = (state.prefs.actions || []).find((x) => x.id === id);
    return a ? a.label : id;
  }

  function keysFor(actionId) {
    return state.prefs.shortcuts[actionId] || '';
  }

  function formatKeysDisplay(keys) {
    if (!keys) return '—';
    return keys.split('>').map((part) =>
      part.split('+').map((k) => {
        if (k === 'ctrl') return 'Ctrl';
        if (k === 'meta') return '⌘';
        if (k === 'enter') return '↵';
        return k.length === 1 ? k.toUpperCase() : k;
      }).join('+')
    ).join(' then ');
  }

  const ACTION_HANDLERS = {
    commandPalette: () => openCommandPalette(),
    markDone: () => actDone(),
    remind: () => openRemindSheet(),
    undoDone: () => actUndoDone(),
    nextThread: () => moveSelection(1),
    prevThread: () => moveSelection(-1),
    search: () => document.getElementById('mail-search')?.focus(),
    sendReply: () => sendReply(),
    sync: () => syncMail(),
    compose: () => alert('Compose from mailbox — coming soon. Use Reply for now.'),
    showHelp: () => showShortcutHelp(),
    openSettings: () => openSettings(),
    goDone: () => selectSplit('done'),
    goReminders: () => selectSplit('reminders'),
    goInbox: () => selectSplit('all'),
  };

  function runAction(actionId) {
    const fn = ACTION_HANDLERS[actionId];
    if (fn) fn();
  }

  function buildCommands() {
    const items = [
      { label: actionLabel('markDone'), keys: keysFor('markDone'), action: () => runAction('markDone') },
      { label: actionLabel('remind'), keys: keysFor('remind'), action: () => runAction('remind') },
      { label: 'Remind: tomorrow (2d)', keys: '', action: () => actRemind('2d') },
      { label: 'Remind: next Monday', keys: '', action: () => actRemind('mon') },
      { label: actionLabel('compose'), keys: keysFor('compose'), action: () => runAction('compose') },
      { label: actionLabel('search'), keys: keysFor('search'), action: () => runAction('search') },
      { label: actionLabel('sync'), keys: keysFor('sync'), action: () => runAction('sync') },
      { label: actionLabel('goDone'), keys: keysFor('goDone'), action: () => runAction('goDone') },
      { label: actionLabel('goReminders'), keys: keysFor('goReminders'), action: () => runAction('goReminders') },
      { label: actionLabel('openSettings'), keys: keysFor('openSettings'), action: () => runAction('openSettings') },
      { label: actionLabel('showHelp'), keys: keysFor('showHelp'), action: () => runAction('showHelp') },
    ];
    return items;
  }

  function normalizeEventKey(e) {
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('ctrl');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey && e.key.length > 1) mods.push('shift');
    let key = e.key.toLowerCase();
    if (key === ' ') key = 'space';
    if (key === 'arrowdown') key = 'down';
    if (key === 'arrowup') key = 'up';
    mods.push(key);
    return mods.join('+');
  }

  function matchShortcut(eventKey) {
    for (const [actionId, binding] of Object.entries(state.prefs.shortcuts)) {
      if (!binding) continue;
      if (binding.includes('>')) {
        const parts = binding.split('>');
        const combo = state.chordBuffer ? state.chordBuffer + '>' + eventKey : eventKey;
        if (combo === binding) return actionId;
        if (parts[0] === eventKey && parts.length > 1) {
          state.chordBuffer = eventKey;
          clearTimeout(state.chordTimer);
          state.chordTimer = setTimeout(() => { state.chordBuffer = ''; }, CHORD_TIMEOUT_MS);
          return null;
        }
        continue;
      }
      if (binding === eventKey) return actionId;
    }
    if (state.chordBuffer) {
      const combo = state.chordBuffer + '>' + eventKey;
      state.chordBuffer = '';
      clearTimeout(state.chordTimer);
      for (const [actionId, binding] of Object.entries(state.prefs.shortcuts)) {
        if (binding === combo) return actionId;
      }
    }
    return null;
  }

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.apiToken}`,
      ...(opts.headers || {}),
    };
    if (method !== 'GET') headers['X-OV-Console'] = '1';
    const res = await fetch(`${state.apiBase}/api${path}`, {
      ...opts,
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getLeads() {
    try { return JSON.parse(localStorage.getItem('omnitender_leads') || '[]'); } catch { return []; }
  }

  function matchLead(thread) {
    const leads = getLeads();
    const email = (thread.from_email || '').toLowerCase();
    return leads.find((l) => {
      const notes = (l.notes || '').toLowerCase();
      const contact = (l.contact || '').toLowerCase();
      return notes.includes(email) || contact.includes(email.split('@')[0]);
    });
  }

  async function refreshCounts() {
    try {
      const data = await api('/splits');
      state.counts = data.counts || {};
    } catch { state.counts = {}; }
  }

  async function loadThreads() {
    const q = document.getElementById('mail-search')?.value?.trim();
    try {
      const data = await api(`/threads?split=${encodeURIComponent(state.split)}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      state.threads = data.threads || [];
    } catch (e) {
      console.warn('[mail]', e.message);
      state.threads = loadLocalFallback();
    }
    renderThreadList();
    renderSplitCounts();
    updateMobileChrome();
  }

  function loadLocalFallback() {
    const raw = localStorage.getItem('omnitender_mail_threads');
    if (raw) {
      try { return JSON.parse(raw).filter((t) => filterLocal(t, state.split)); } catch { /* ignore */ }
    }
    return [];
  }

  function filterLocal(t, split) {
    if (split === 'all') return t.status === 'inbox';
    if (split === 'done') return t.status === 'done';
    if (split === 'reminders') return t.status === 'reminder';
    return t.status === 'inbox' && t.split_key === split;
  }

  async function loadThread(id) {
    state.selectedId = id;
    try {
      const data = await api(`/threads/${id}`);
      state.threadDetail = data.thread;
    } catch {
      state.threadDetail = state.threads.find((t) => t.id === id) || null;
    }
    if (isTouchDevice()) state.mobileView = 'reading';
    renderThreadList();
    renderReadingPane();
    updateMobileChrome();
  }

  async function actDone() {
    if (!state.selectedId) return;
    await api(`/threads/${state.selectedId}/done`, { method: 'POST' });
    state.selectedId = null;
    state.threadDetail = null;
    if (isTouchDevice()) state.mobileView = 'list';
    await loadThreads();
    renderReadingPane();
    updateMobileChrome();
  }

  async function actUndoDone() {
    if (!state.selectedId) return;
    await api(`/threads/${state.selectedId}/undo-done`, { method: 'POST' });
    await loadThread(state.selectedId);
    await refreshCounts();
  }

  async function actRemind(when) {
    if (!state.selectedId) return;
    closeRemindSheet();
    await api(`/threads/${state.selectedId}/remind`, { method: 'POST', body: { when } });
    state.selectedId = null;
    state.threadDetail = null;
    if (isTouchDevice()) state.mobileView = 'list';
    await loadThreads();
    renderReadingPane();
    updateMobileChrome();
  }

  function openRemindSheet() {
    if (!state.selectedId) return;
    state.remindOpen = true;
    document.getElementById('mail-remind-sheet')?.classList.remove('hidden');
  }

  function closeRemindSheet() {
    state.remindOpen = false;
    document.getElementById('mail-remind-sheet')?.classList.add('hidden');
  }

  async function syncMail() {
    setStatus('Syncing IMAP…');
    try {
      const data = await api('/sync', { method: 'POST' });
      setStatus(`Sync complete — ${JSON.stringify(data.results)}`);
      await refreshCounts();
      await loadThreads();
    } catch (e) {
      setStatus(`Sync failed: ${e.message}`);
    }
  }

  async function sendReply() {
    const body = document.getElementById('mail-reply-body')?.value?.trim();
    if (!body || !state.threadDetail) return;
    const t = state.threadDetail;
    const lastMsg = t.messages?.[t.messages.length - 1];
    try {
      await api('/send', {
        method: 'POST',
        body: {
          mailboxId: t.mailbox_id,
          to: t.from_email,
          subject: t.subject.startsWith('Re:') ? t.subject : `Re: ${t.subject}`,
          body,
          threadId: t.id,
          inReplyTo: lastMsg?.message_id,
        },
      });
      document.getElementById('mail-reply-body').value = '';
      setStatus('Sent');
      await loadThread(t.id);
    } catch (e) {
      setStatus(`Send failed: ${e.message}`);
    }
  }

  function selectSplit(key) {
    state.split = key;
    state.selectedId = null;
    state.threadDetail = null;
    state.mobileView = 'list';
    document.querySelectorAll('.mail-split-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.split === key);
    });
    closeSplitsDrawer();
    loadThreads();
    renderReadingPane();
    updateMobileChrome();
  }

  function setStatus(msg) {
    const el = document.getElementById('mail-status');
    if (el) el.textContent = msg;
  }

  function updateShortcutHints() {
    const hint = document.getElementById('mail-shortcut-hint-text');
    if (hint) {
      hint.innerHTML = isTouchDevice()
        ? 'Swipe right = done · Swipe left = remind · Tap thread to read'
        : `<kbd>${escapeHtml(formatKeysDisplay(keysFor('commandPalette')))}</kbd> command · <kbd>${escapeHtml(formatKeysDisplay(keysFor('markDone')))}</kbd> done · <kbd>${escapeHtml(formatKeysDisplay(keysFor('remind')))}</kbd> remind · <kbd>${escapeHtml(formatKeysDisplay(keysFor('nextThread')))}</kbd>/<kbd>${escapeHtml(formatKeysDisplay(keysFor('prevThread')))}</kbd> navigate · <button type="button" class="mail-link-btn" id="mail-open-settings-inline">Customize</button>`;
      document.getElementById('mail-open-settings-inline')?.addEventListener('click', openSettings);
    }
  }

  function renderSplitCounts() {
    const total = state.counts.total_inbox ?? state.threads.length;
    const countEl = document.getElementById('mail-inbox-count');
    if (countEl) countEl.textContent = total;
    document.querySelectorAll('.mail-split-btn .mail-split-count').forEach((el) => {
      const key = el.closest('.mail-split-btn')?.dataset.split;
      if (key === 'all') el.textContent = total;
      else if (key === 'done') el.textContent = state.counts.done ?? 0;
      else if (key === 'reminders') el.textContent = state.counts.reminders ?? 0;
      else el.textContent = state.counts.splits?.[key] ?? 0;
    });
  }

  function bindSwipe(row, threadId) {
    let startX = 0;
    let currentX = 0;
    let dragging = false;
    const inner = row.querySelector('.mail-thread-inner') || row;

    function onStart(x) {
      startX = x;
      currentX = 0;
      dragging = true;
      inner.style.transition = 'none';
    }
    function onMove(x) {
      if (!dragging) return;
      currentX = x - startX;
      inner.style.transform = `translateX(${currentX}px)`;
      row.classList.toggle('swipe-right-hint', currentX > 20);
      row.classList.toggle('swipe-left-hint', currentX < -20);
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      inner.style.transition = 'transform 0.2s ease';
      inner.style.transform = '';
      row.classList.remove('swipe-right-hint', 'swipe-left-hint');
      const touch = state.prefs.touch || {};
      row._lastSwipe = currentX;
      setTimeout(() => { row._lastSwipe = 0; }, 350);
      if (currentX > SWIPE_THRESHOLD && touch.swipeRight && touch.swipeRight !== 'none') {
        loadThread(threadId).then(() => runAction(touch.swipeRight));
      } else if (currentX < -SWIPE_THRESHOLD && touch.swipeLeft && touch.swipeLeft !== 'none') {
        loadThread(threadId).then(() => runAction(touch.swipeLeft));
      }
    }

    row.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX), { passive: true });
    row.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX), { passive: true });
    row.addEventListener('touchend', onEnd);
  }

  function renderThreadList() {
    const container = document.getElementById('mail-threads');
    if (!container) return;
    if (!state.threads.length) {
      container.innerHTML = `<div class="mail-reading-empty">Inbox zero in this split.<br><small>${isTouchDevice() ? 'Swipe threads or use the action bar below' : 'Customize shortcuts in Settings (gear icon)'}</small></div>`;
      return;
    }
    container.innerHTML = state.threads.map((t, i) => {
      const dotClass = t.status === 'reminder' ? 'reminder' : (t.is_unread ? 'unread' : '');
      return `
        <div class="mail-thread-row ${t.is_unread ? 'unread' : ''} ${state.selectedId === t.id ? 'active' : ''}"
             data-id="${escapeHtml(t.id)}" data-index="${i}">
          <div class="mail-thread-inner">
            <div class="mail-swipe-bg mail-swipe-bg-right">Done</div>
            <div class="mail-swipe-bg mail-swipe-bg-left">Remind</div>
            <div class="mail-thread-content">
              <div class="mail-thread-meta">
                <span><span class="mail-dot ${dotClass}"></span>${escapeHtml(t.from_name || t.from_email)}</span>
                <span>${fmtTime(t.last_message_at)}</span>
              </div>
              <div class="mail-thread-subject">${escapeHtml(t.subject)}</div>
              <div class="mail-thread-snippet">${escapeHtml(t.snippet)}</div>
            </div>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.mail-thread-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (Math.abs(row._lastSwipe || 0) > SWIPE_THRESHOLD) return;
        loadThread(row.dataset.id);
      });
      if (isTouchDevice()) bindSwipe(row, row.dataset.id);
    });
  }

  function renderReadingPane() {
    const pane = document.getElementById('mail-reading-pane');
    if (!pane) return;
    const t = state.threadDetail;
    if (!t) {
      const addr = employeeMailAddress();
      pane.innerHTML = `<div class="mail-reading-empty">
        <div>
          <strong>Your OmniTender inbox</strong><br>
          <span style="color:var(--muted);font-size:13px;">${escapeHtml(addr)}</span><br><br>
          Work from what needs action — not unread count.<br><br>
          ${isTouchDevice()
            ? 'Tap a thread to read. Swipe right to archive, left to remind.'
            : `<kbd>${escapeHtml(formatKeysDisplay(keysFor('markDone')))}</kbd> mark done &nbsp; <kbd>${escapeHtml(formatKeysDisplay(keysFor('remind')))}</kbd> remind &nbsp; <kbd>${escapeHtml(formatKeysDisplay(keysFor('nextThread')))}</kbd>/<kbd>${escapeHtml(formatKeysDisplay(keysFor('prevThread')))}</kbd> move`}
          <br><br>
          <button type="button" class="mail-btn-sm" id="mail-empty-settings">Customize shortcuts</button>
        </div>
      </div>`;
      document.getElementById('mail-empty-settings')?.addEventListener('click', openSettings);
      return;
    }

    const lead = matchLead(t);
    const messages = t.messages || [{ from_email: t.from_email, from_name: t.from_name, body_text: t.snippet, sent_at: t.last_message_at, direction: 'inbound' }];

    pane.innerHTML = `
      <div class="mail-reading-header">
        <button type="button" class="mail-back-btn" id="mail-back-btn" aria-label="Back to list">←</button>
        <div class="mail-reading-head-text">
          <h2>${escapeHtml(t.subject)}</h2>
          <div class="mail-reading-from">${escapeHtml(t.from_name || '')} &lt;${escapeHtml(t.from_email)}&gt; · ${escapeHtml(t.mailbox_name || t.mailbox_address || '')}</div>
        </div>
        <div class="mail-reading-actions">
          <button type="button" class="mail-btn-sm primary" id="mail-act-done">Done</button>
          <button type="button" class="mail-btn-sm" id="mail-act-remind">Remind</button>
          ${lead ? `<span class="mail-btn-sm mail-crm-badge">CRM: ${escapeHtml(lead.name)}</span>` : ''}
        </div>
      </div>
      <div class="mail-messages">
        ${messages.map((m) => `
          <div class="mail-message-block">
            <div class="mail-message-meta">${escapeHtml(m.from_name || m.from_email)} · ${fmtTime(m.sent_at)} · ${m.direction || 'inbound'}</div>
            <div class="mail-message-body">${escapeHtml(m.body_text || m.snippet || '')}</div>
          </div>`).join('')}
      </div>
      <div class="mail-compose-bar">
        <textarea id="mail-reply-body" placeholder="Reply…" enterkeyhint="send"></textarea>
        <button type="button" class="btn-primary" id="mail-send-reply">Send Reply</button>
      </div>`;

    document.getElementById('mail-back-btn')?.addEventListener('click', () => {
      state.mobileView = 'list';
      state.selectedId = null;
      state.threadDetail = null;
      renderThreadList();
      renderReadingPane();
      updateMobileChrome();
    });
    document.getElementById('mail-act-done')?.addEventListener('click', actDone);
    document.getElementById('mail-act-remind')?.addEventListener('click', openRemindSheet);
    document.getElementById('mail-send-reply')?.addEventListener('click', sendReply);
    document.getElementById('mail-reply-body')?.addEventListener('keydown', (e) => {
      const binding = keysFor('sendReply');
      const key = normalizeEventKey(e);
      if (binding && binding === key) { sendReply(); e.preventDefault(); }
    });
    updateMobileChrome();
  }

  function updateMobileChrome() {
    const app = document.getElementById('mail-app');
    if (!app) return;
    app.classList.toggle('mobile-reading', state.mobileView === 'reading');
    app.classList.toggle('mobile-splits', state.mobileView === 'splits');
    const bar = document.getElementById('mail-touch-bar');
    if (bar) {
      const show = isTouchDevice() && state.prefs.touch?.showTouchBar !== false;
      bar.classList.toggle('hidden', !show);
      bar.classList.toggle('has-thread', !!state.threadDetail);
    }
  }

  function openCommandPalette() {
    state.cmdOpen = true;
    state.cmdIndex = 0;
    document.getElementById('mail-cmd-overlay')?.classList.remove('hidden');
    const input = document.getElementById('mail-cmd-input');
    if (input) { input.value = ''; input.focus(); }
    renderCommandResults('');
  }

  function closeCommandPalette() {
    state.cmdOpen = false;
    document.getElementById('mail-cmd-overlay')?.classList.add('hidden');
  }

  function renderCommandResults(filter) {
    const q = filter.toLowerCase();
    const items = buildCommands().filter((c) => c.label.toLowerCase().includes(q));
    const container = document.getElementById('mail-cmd-results');
    if (!container) return;
    container.innerHTML = items.map((c, i) => `
      <div class="mail-cmd-item ${i === state.cmdIndex ? 'active' : ''}" data-index="${i}">
        <span>${escapeHtml(c.label)}</span>
        <span class="mail-cmd-key">${escapeHtml(formatKeysDisplay(c.keys))}</span>
      </div>`).join('');
    container.querySelectorAll('.mail-cmd-item').forEach((el) => {
      el.addEventListener('click', () => {
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
    const lines = (state.prefs.actions || []).map((a) => {
      const k = keysFor(a.id);
      return k ? `${formatKeysDisplay(k)} — ${a.label}` : null;
    }).filter(Boolean);
    alert('Your mail shortcuts\n\n' + lines.join('\n') + '\n\nCustomize any shortcut in Settings (gear icon). Bindings are saved to your employee account.');
  }

  function moveSelection(delta) {
    if (!state.threads.length) return;
    let idx = state.threads.findIndex((t) => t.id === state.selectedId);
    if (idx < 0) idx = 0;
    else idx = Math.max(0, Math.min(state.threads.length - 1, idx + delta));
    loadThread(state.threads[idx].id);
  }

  function openSettings() {
    state.settingsOpen = true;
    document.getElementById('mail-settings-overlay')?.classList.remove('hidden');
    renderSettingsPanel();
  }

  function closeSettings() {
    state.settingsOpen = false;
    state.recordingActionId = null;
    document.getElementById('mail-settings-overlay')?.classList.add('hidden');
    updateShortcutHints();
  }

  function renderSettingsPanel() {
    const list = document.getElementById('mail-settings-list');
    if (!list) return;
    const actions = state.prefs.actions.length ? state.prefs.actions : [
      { id: 'markDone', label: 'Mark done', defaultKeys: 'e' },
      { id: 'remind', label: 'Remind', defaultKeys: 'h' },
    ];
    list.innerHTML = actions.map((a) => {
      const current = keysFor(a.id) || a.defaultKeys || '';
      const recording = state.recordingActionId === a.id;
      return `
        <div class="mail-settings-row">
          <div class="mail-settings-label">${escapeHtml(a.label)}</div>
          <button type="button" class="mail-key-cap ${recording ? 'recording' : ''}" data-action="${a.id}">
            ${recording ? 'Press keys…' : escapeHtml(formatKeysDisplay(current) || 'None')}
          </button>
          <button type="button" class="mail-btn-sm mail-clear-key" data-action="${a.id}" title="Clear">×</button>
        </div>`;
    }).join('');

    list.querySelectorAll('.mail-key-cap').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.recordingActionId = btn.dataset.action;
        renderSettingsPanel();
      });
    });
    list.querySelectorAll('.mail-clear-key').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await savePreferences({ shortcuts: { [btn.dataset.action]: '' } });
        renderSettingsPanel();
      });
    });

    const touchRight = document.getElementById('mail-touch-swipe-right');
    const touchLeft = document.getElementById('mail-touch-swipe-left');
    const touchBar = document.getElementById('mail-touch-bar-toggle');
    if (touchRight) touchRight.value = state.prefs.touch?.swipeRight || 'markDone';
    if (touchLeft) touchLeft.value = state.prefs.touch?.swipeLeft || 'remind';
    if (touchBar) touchBar.checked = state.prefs.touch?.showTouchBar !== false;
  }

  function openSplitsDrawer() {
    state.mobileView = 'splits';
    updateMobileChrome();
  }

  function closeSplitsDrawer() {
    if (state.mobileView === 'splits') state.mobileView = 'list';
    updateMobileChrome();
  }

  function isMailViewActive() {
    const mailView = document.getElementById('v-mail');
    if (mailView && mailView.classList.contains('on')) return true;
    return document.getElementById('section-mail') && !document.getElementById('section-mail').classList.contains('hidden');
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!isMailViewActive()) return;

      if (state.settingsOpen && state.recordingActionId) {
        e.preventDefault();
        if (e.key === 'Escape') { state.recordingActionId = null; renderSettingsPanel(); return; }
        const key = normalizeEventKey(e);
        if (key === 'escape') return;
        savePreferences({ shortcuts: { [state.recordingActionId]: key } }).then(() => {
          state.recordingActionId = null;
          renderSettingsPanel();
        });
        return;
      }

      if (state.cmdOpen) {
        if (e.key === 'Escape') { closeCommandPalette(); e.preventDefault(); return; }
        if (e.key === 'ArrowDown') { state.cmdIndex = Math.min((state._cmdItems?.length || 1) - 1, state.cmdIndex + 1); renderCommandResults(document.getElementById('mail-cmd-input')?.value || ''); e.preventDefault(); return; }
        if (e.key === 'ArrowUp') { state.cmdIndex = Math.max(0, state.cmdIndex - 1); renderCommandResults(document.getElementById('mail-cmd-input')?.value || ''); e.preventDefault(); return; }
        if (e.key === 'Enter') { runCommandAt(state.cmdIndex); e.preventDefault(); return; }
        return;
      }

      if (state.remindOpen || state.settingsOpen) {
        if (e.key === 'Escape') { closeRemindSheet(); closeSettings(); e.preventDefault(); }
        return;
      }

      const inField = e.target.matches('input, textarea') && e.key !== 'Escape';
      if (inField) {
        const key = normalizeEventKey(e);
        if (keysFor('sendReply') === key && e.target.id === 'mail-reply-body') return;
        return;
      }

      const actionId = matchShortcut(normalizeEventKey(e));
      if (actionId) { runAction(actionId); e.preventDefault(); }
    });

    document.getElementById('mail-cmd-input')?.addEventListener('input', (e) => {
      state.cmdIndex = 0;
      renderCommandResults(e.target.value);
    });
    document.getElementById('mail-cmd-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'mail-cmd-overlay') closeCommandPalette();
    });
  }

  function bindSettingsUi() {
    document.getElementById('mail-settings-close')?.addEventListener('click', closeSettings);
    document.getElementById('mail-settings-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'mail-settings-overlay') closeSettings();
    });
    document.getElementById('mail-settings-reset')?.addEventListener('click', resetPreferences);
    document.getElementById('mail-settings-save-touch')?.addEventListener('click', async () => {
      await savePreferences({
        touch: {
          swipeRight: document.getElementById('mail-touch-swipe-right')?.value || 'markDone',
          swipeLeft: document.getElementById('mail-touch-swipe-left')?.value || 'remind',
          showTouchBar: document.getElementById('mail-touch-bar-toggle')?.checked !== false,
        },
      });
      setStatus('Touch settings saved');
      updateMobileChrome();
    });
    document.getElementById('mail-settings-btn')?.addEventListener('click', openSettings);
    document.getElementById('mail-splits-toggle')?.addEventListener('click', openSplitsDrawer);
    document.getElementById('mail-splits-close')?.addEventListener('click', closeSplitsDrawer);

    document.getElementById('mail-touch-done')?.addEventListener('click', () => { if (state.selectedId) actDone(); else setStatus('Select a thread first'); });
    document.getElementById('mail-touch-remind')?.addEventListener('click', () => { if (state.selectedId) openRemindSheet(); else setStatus('Select a thread first'); });
    document.getElementById('mail-touch-cmd')?.addEventListener('click', openCommandPalette);

    document.querySelectorAll('[data-remind-when]').forEach((btn) => {
      btn.addEventListener('click', () => actRemind(btn.dataset.remindWhen));
    });
    document.getElementById('mail-remind-custom')?.addEventListener('click', () => {
      const when = document.getElementById('mail-remind-custom-input')?.value?.trim();
      if (when) actRemind(when);
    });
    document.getElementById('mail-remind-close')?.addEventListener('click', closeRemindSheet);
    document.getElementById('mail-remind-sheet')?.addEventListener('click', (e) => {
      if (e.target.id === 'mail-remind-sheet') closeRemindSheet();
    });
  }

  function renderShell() {
    const section = document.getElementById('section-mail');
    if (!section || section.dataset.rendered) return;
    section.dataset.rendered = '1';

    section.innerHTML = `
      <div class="mail-app" id="mail-app">
        <aside class="mail-splits" id="mail-splits-panel">
          <div class="mail-splits-header">
            <button type="button" class="mail-splits-close-btn" id="mail-splits-close" aria-label="Close splits">×</button>
            <h3>Your inbox</h3>
            <div class="mail-inbox-count" id="mail-inbox-count">—</div>
          </div>
          <div class="mail-split-list" id="mail-split-list">
            ${SPLITS.map((s) => `
              <button type="button" class="mail-split-btn ${s.key === 'all' ? 'active' : ''}" data-split="${s.key}">
                <span>${s.label}</span>
                <span class="mail-split-count">0</span>
              </button>`).join('')}
          </div>
          <div class="mail-mailboxes">
            <div class="mail-mailbox-label">Your address</div>
            <div class="mail-mailbox-chip mail-mailbox-you" id="mail-your-address" title="Your OmniTender mailbox">${escapeHtml(employeeMailAddress())}</div>
          </div>
        </aside>
        <div class="mail-thread-list">
          <div class="mail-thread-toolbar">
            <button type="button" class="mail-icon-btn" id="mail-splits-toggle" aria-label="Splits">☰</button>
            <input type="search" class="mail-search" id="mail-search" placeholder="Search…" enterkeyhint="search">
            <button type="button" class="mail-icon-btn" id="mail-settings-btn" aria-label="Shortcut settings">⚙</button>
            <button type="button" class="mail-btn-sm" id="mail-sync-btn">Sync</button>
          </div>
          <div class="mail-threads" id="mail-threads"></div>
          <div class="mail-shortcut-hint" id="mail-shortcut-hint-text"></div>
        </div>
        <div class="mail-reading-pane" id="mail-reading-pane"></div>
      </div>
      <div class="mail-touch-bar hidden" id="mail-touch-bar">
        <button type="button" id="mail-touch-done">Done</button>
        <button type="button" id="mail-touch-remind">Remind</button>
        <button type="button" id="mail-touch-cmd">Commands</button>
      </div>
      <div class="mail-status-bar" id="mail-status">Your OmniTender mail — same session as this console</div>
      <div class="mail-cmd-overlay hidden" id="mail-cmd-overlay">
        <div class="mail-cmd-panel">
          <input class="mail-cmd-input" id="mail-cmd-input" placeholder="Type a command…" autocomplete="off" enterkeyhint="go">
          <div class="mail-cmd-results" id="mail-cmd-results"></div>
        </div>
      </div>
      <div class="mail-sheet-overlay hidden" id="mail-remind-sheet">
        <div class="mail-sheet">
          <div class="mail-sheet-header">
            <strong>Remind me</strong>
            <button type="button" class="mail-sheet-close" id="mail-remind-close">×</button>
          </div>
          <div class="mail-sheet-body">
            ${REMIND_PRESETS.map((p) => `<button type="button" class="mail-sheet-option" data-remind-when="${p.when}">${p.label}</button>`).join('')}
            <div class="mail-sheet-custom">
              <input type="text" id="mail-remind-custom-input" placeholder="mon, 2d, 1w, or YYYY-MM-DD" enterkeyhint="done">
              <button type="button" class="mail-btn-sm primary" id="mail-remind-custom">Set</button>
            </div>
          </div>
        </div>
      </div>
      <div class="mail-settings-overlay hidden" id="mail-settings-overlay">
        <div class="mail-settings-panel">
          <div class="mail-settings-header">
            <h3>Mail shortcuts & touch</h3>
            <button type="button" class="mail-sheet-close" id="mail-settings-close">×</button>
          </div>
          <p class="mail-settings-intro">Click any binding to change it. Shortcuts are saved to your employee account on the server.</p>
          <div class="mail-settings-list" id="mail-settings-list"></div>
          <div class="mail-settings-touch">
            <h4>Touch / mobile</h4>
            <label>Swipe right <select id="mail-touch-swipe-right"><option value="markDone">Mark done</option><option value="remind">Remind</option><option value="none">None</option></select></label>
            <label>Swipe left <select id="mail-touch-swipe-left"><option value="remind">Remind</option><option value="markDone">Mark done</option><option value="none">None</option></select></label>
            <label class="mail-check-row"><input type="checkbox" id="mail-touch-bar-toggle" checked> Show bottom action bar on mobile</label>
            <button type="button" class="mail-btn-sm primary" id="mail-settings-save-touch">Save touch settings</button>
          </div>
          <button type="button" class="mail-btn-sm" id="mail-settings-reset">Reset all to defaults</button>
        </div>
      </div>`;

    document.querySelectorAll('.mail-split-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectSplit(btn.dataset.split));
    });
    document.getElementById('mail-sync-btn')?.addEventListener('click', syncMail);
    document.getElementById('mail-search')?.addEventListener('input', () => loadThreads());
    bindKeyboard();
    bindSettingsUi();
  }

  window.OmniTenderMail = {
    async init() {
      personalizeMailIntro();
      const addrEl = document.getElementById('mail-your-address');
      if (addrEl) addrEl.textContent = employeeMailAddress();
      state.apiBase = localStorage.getItem('omnitender_mail_api') || defaultApiBase();
      state.apiToken = getDashToken()
        || localStorage.getItem('omnitender_mail_token')
        || ((window.location.hostname.includes('fly.dev') || window.location.hostname.endsWith('omnitender.us'))
          ? 'omnitender-preview-2026' : 'dev-local-token');
      renderShell();
      await loadPreferences();
      updateShortcutHints();
      if (!getDashToken()) {
        const bar = document.getElementById('mail-status');
        if (bar) bar.textContent = 'Sign in to the dashboard first — mail uses the same session token.';
      }
      refreshCounts().then(loadThreads).catch((err) => {
        const bar = document.getElementById('mail-status');
        if (bar) bar.textContent = 'Mail API unreachable: ' + err.message;
      });
      renderReadingPane();
      window.addEventListener('resize', updateMobileChrome);
    },
    refresh: loadThreads,
  };
})();
