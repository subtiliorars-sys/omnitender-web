// workboard.js — OmniTender Workboard (employee human-work Kanban + Express Lane)
// Self-contained IIFE, mirroring feedback.js: it owns its API base, esc, and
// helpers rather than depending on dashboard.js internals.
//
// Backend contract (OmniVerse, validated):
//   GET  /api/workboard              -> { items, statuses, priorities, areas, express:{capacity,open} }
//   POST /api/workboard              -> 201 { item }  (body: title,nextAction,description,area,priority,dueDate,githubUrl,express,expressReason)
//   POST /api/workboard/:id          -> { item }      (any subset of updatable fields)
// CSRF/auth via Authorization: Bearer from sessionStorage 'omni_dash_token'.
(function () {
  'use strict';

  var API = window.location.hostname === 'omnitender-omniverse.fly.dev' || window.location.port === '3000'
    ? ''
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '[::1]'
      ? 'http://' + window.location.hostname + ':3000'
      : 'https://omnitender-omniverse.fly.dev');

  var STATUS_LABELS = {
    intake: '📥 Intake', ready: '🟢 Ready', doing: '🔵 Doing',
    waiting: '🕓 Waiting', review: '🔍 Review', done: '✅ Done'
  };
  var PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High' };
  var AREA_LABELS = {
    sales: 'Sales', operations: 'Operations', support: 'Support',
    compliance: 'Compliance', marketing: 'Marketing', product: 'Product', other: 'Other'
  };

  var _currentUserRole = sessionStorage.getItem('omni_dash_role') || 'Employee';
  var _currentUser = sessionStorage.getItem('omni_dash_username') || '';
  var _cache = [];   // workboard cards
  var _meta = null;  // statuses/priorities/areas/express from server
  var _inited = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\//g, '&#47;');
  }

  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.style.display = 'block';
    setTimeout(function () { t.style.display = 'none'; }, 3500);
  }

  function authHeaders() {
    return { 'Authorization': 'Bearer ' + (sessionStorage.getItem('omni_dash_token') || '') };
  }

  async function api(path, opts) {
    var o = opts || {};
    var init = { method: o.method || 'GET', headers: authHeaders() };
    if (init.method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-OV-Console'] = '1';
      init.body = JSON.stringify(o.body || {});
    }
    var r = await fetch(API + path, init);
    var ct = r.headers.get('content-type') || '';
    var data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
    return data;
  }

  function ownerLabel(card) {
    if (!card.owner) return '';
    return '👤 ' + esc(card.owner);
  }

  function cardCanEdit(card) {
    return _currentUserRole === 'Admin' || _currentUserRole === 'Owner' ||
      card.owner === _currentUser || card.createdBy === _currentUser;
  }

  function cardChipHtml(card) {
    var chips = [];
    if (card.priority && card.priority !== 'normal') {
      chips.push('<span class="wb-chip wb-prio-' + esc(card.priority) + '">' + esc(PRIORITY_LABELS[card.priority] || card.priority) + '</span>');
    }
    if (card.area) {
      chips.push('<span class="wb-chip">' + esc(AREA_LABELS[card.area] || card.area) + '</span>');
    }
    if (card.dueDate) {
      chips.push('<span class="wb-chip wb-due">📅 ' + esc(card.dueDate) + '</span>');
    }
    var s = chips.join('');
    if (card.githubUrl) {
      s += '<a class="wb-chip wb-gh" href="' + esc(card.githubUrl) + '" target="_blank" rel="noopener">↗ GitHub</a>';
    }
    return s;
  }

  function cardHtml(card) {
    var canEdit = cardCanEdit(card);
    var actions = '';
    if (canEdit) {
      var editBtn = '<button type="button" class="wb-btn wb-btn-mini" data-wb-edit="' + card.id + '">Edit</button>';
      var delBtn = '<button type="button" class="wb-btn wb-btn-mini wb-btn-del" data-wb-del="' + card.id + '">Remove</button>';
      if (card.status !== 'done') {
        var expressBtn = card.express
          ? '<button type="button" class="wb-btn wb-btn-mini" data-wb-express="' + card.id + '">Remove Express</button>'
          : '<button type="button" class="wb-btn wb-btn-mini wb-btn-express" data-wb-express="' + card.id + '">⚡ Express</button>';
        actions = '<div class="wb-card-actions">' + editBtn + expressBtn + delBtn + '</div>';
      } else {
        actions = '<div class="wb-card-actions">' + editBtn + delBtn + '</div>';
      }
    }
    return '<div class="wb-card' + (card.express ? ' wb-card-express' : '') + '" data-id="' + card.id + '">' +
      '<div class="wb-card-title">' + esc(card.title) + '</div>' +
      (card.express && card.expressReason ? '<div class="wb-express-reason">⚡ ' + esc(card.expressReason) + '</div>' : '') +
      '<div class="wb-card-owner">' + ownerLabel(card) + '</div>' +
      (card.nextAction ? '<div class="wb-next-action"><span class="wb-next-label">Next:</span> ' + esc(card.nextAction) + '</div>' : '') +
      cardChipHtml(card) +
      actions +
      '</div>';
  }

  function renderBoard() {
    var root = document.getElementById('workboard-root');
    if (!root) return;

    var flowCols = ['intake', 'ready', 'doing', 'waiting', 'review', 'done'];
    var html = '<div class="wb-toolbar">' +
      '<button type="button" class="wb-btn wb-btn-primary" id="wb-new-card">+ New Card</button>' +
      '<span class="wb-toolbar-note" id="wb-summary"></span>' +
      '</div>' +
      '<div class="wb-lanes">';

    flowCols.forEach(function (status) {
      var cards = _cache.filter(function (c) { return c.status === status; }) || [];
      html += '<div class="wb-lane" data-lane="' + status + '">' +
        '<div class="wb-lane-head">' + STATUS_LABELS[status] + ' <span class="wb-lane-count">' + cards.length + '</span></div>' +
        '<div class="wb-lane-body">' + (cards.length ? cards.map(cardHtml).join('') : '<div class="wb-empty">Empty</div>') + '</div>' +
        '</div>';
    });

    html += '</div>';

    var expressCards = _cache.filter(function (c) { return c.express && c.status !== 'done'; }) || [];
    var capacity = (_meta && _meta.express && _meta.express.capacity) || 3;
    html += '<div class="wb-express-lane">' +
      '<div class="wb-express-head">⚡ Express Lane <span class="wb-lane-count">' + expressCards.length + '/' + capacity + '</span></div>' +
      '<div class="wb-express-body">' +
      (expressCards.length ? expressCards.map(cardHtml).join('') : '<div class="wb-empty">No same-day blockers. Use only for genuine 24h-exception work.</div>') +
      '</div>' +
      '<div class="wb-express-note">Same-day blockers only — hard cap of ' + capacity + ' enforced server-side.</div>' +
      '</div>';

    root.innerHTML = html;

    var total = _cache.length;
    var doing = _cache.filter(function (c) { return c.status === 'doing' || c.status === 'review' || c.status === 'waiting'; }).length;
    document.getElementById('wb-summary').textContent = total + ' cards · ' + doing + ' active';

    bindBoardEvents();
  }

  function bindBoardEvents() {
    var root = document.getElementById('workboard-root');
    if (!root) return;
    var newBtn = document.getElementById('wb-new-card');
    if (newBtn) newBtn.addEventListener('click', openNewCard);
    root.querySelectorAll('[data-wb-edit]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); editCard(btn.getAttribute('data-wb-edit')); });
    });
    root.querySelectorAll('[data-wb-del]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); deleteCard(btn.getAttribute('data-wb-del')); });
    });
    root.querySelectorAll('[data-wb-express]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); toggleExpress(btn.getAttribute('data-wb-express')); });
    });
  }


  function openNewCard() {
    var root = document.getElementById('workboard-root');
    if (!root) return;
    root.insertAdjacentHTML('afterbegin', formModalHtml(null));
    bindModalEvents(null);
    var cb = document.getElementById('wb-form-express');
    if (cb) cb.addEventListener('change', function () {
      var box = document.getElementById('wb-form-express-reason');
      if (box) box.style.display = this.checked ? 'block' : 'none';
    });
  }

  function editCard(id) {
    var card = _cache.find(function (c) { return c.id === id; });
    if (!card) return;
    if (!cardCanEdit(card)) { toast('You cannot edit a card you do not own.', true); return; }
    var root = document.getElementById('workboard-root');
    if (!root) return;
    root.insertAdjacentHTML('afterbegin', formModalHtml(card));
    bindModalEvents(card.id);
  }

  function formModalHtml(card) {
    var c = card || {};
    var isEdit = !!card;
    var areaOpts = (_meta.areas || []).map(function (a) {
      return '<option value="' + esc(a) + '"' + (a === (c.area || 'operations') ? ' selected' : '') + '>' + esc(AREA_LABELS[a] || a) + '</option>';
    }).join('');
    var prioOpts = (_meta.priorities || []).map(function (p) {
      return '<option value="' + esc(p) + '"' + (p === (c.priority || 'normal') ? ' selected' : '') + '>' + esc(PRIORITY_LABELS[p] || p) + '</option>';
    }).join('');
    var statusOpts = _meta.statuses.map(function (st) {
      return '<option value="' + esc(st) + '"' + (st === (c.status || 'intake') ? ' selected' : '') + '>' + esc(STATUS_LABELS[st] || st) + '</option>';
    }).join('');

    return '<div class="wb-modal-backdrop" id="wb-modal">' +
      '<div class="wb-modal">' +
      '<div class="wb-modal-head">' + (isEdit ? 'Edit Card' : 'New Card') +
      '<button type="button" class="wb-modal-x" id="wb-modal-close">&times;</button></div>' +
      '<div class="wb-modal-body">' +
      '<label class="wb-field"><span>Title *</span><input id="wb-form-title" value="' + esc(c.title || '') + '" placeholder="e.g. Call merchant partner about onboarding"></label>' +
      '<label class="wb-field"><span>Next action *</span><input id="wb-form-next" value="' + esc(c.nextAction || '') + '" placeholder="What is the very next step?"></label>' +
      '<label class="wb-field"><span>Description / details</span><textarea id="wb-form-desc" rows="3">' + esc(c.description || '') + '</textarea></label>' +
      '<div class="wb-row">' +
      '<label class="wb-field"><span>Area</span><select id="wb-form-area">' + areaOpts + '</select></label>' +
      '<label class="wb-field"><span>Priority</span><select id="wb-form-priority">' + prioOpts + '</select></label>' +
      '</div>' +
      '<div class="wb-row">' +
      '<label class="wb-field"><span>Due date</span><input id="wb-form-due" type="date" value="' + esc(c.dueDate || '') + '"></label>' +
      '<label class="wb-field"><span>Status</span><select id="wb-form-status">' + statusOpts + '</select></label>' +
      '</div>' +
      '<label class="wb-field"><span>GitHub link (issue or PR)</span><input id="wb-form-gh" value="' + esc(c.githubUrl || '') + '" placeholder="https://github.com/subtiliorars-sys/.../issues/42"></label>' +
      '<label class="wb-field wb-check"><input type="checkbox" id="wb-form-express"' + (c.express ? ' checked' : '') + '> ⚡ Mark as Express Lane (same-day blocker)</label>' +
      '<label class="wb-field wb-express-reason-wrap" id="wb-form-express-reason"' + (c.express ? '' : ' style="display:none"') + '>' +
      '<span>Express reason *</span><input id="wb-form-express-reason-input" value="' + esc(c.expressReason || '') + '" placeholder="Why must this be resolved today?"></label>' +
      '</div>' +
      '<div class="wb-modal-foot">' +
      '<button type="button" class="wb-btn wb-btn-primary" id="wb-form-save">' + (isEdit ? 'Save Changes' : 'Create Card') + '</button>' +
      '<button type="button" class="wb-btn" id="wb-modal-cancel">Cancel</button>' +
      '<span class="wb-form-status" id="wb-form-status"></span>' +
      '</div>' +
      '</div></div></div>';
  }


  function bindModalEvents(cardId) {
    var close = document.getElementById('wb-modal-close');
    var cancel = document.getElementById('wb-modal-cancel');
    var backdrop = document.getElementById('wb-modal');
    var save = document.getElementById('wb-form-save');
    var statusEl = document.getElementById('wb-form-status');
    if (close) close.addEventListener('click', closeModal);
    if (cancel) cancel.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
    if (save) save.addEventListener('click', async function () {
      save.disabled = true;
      save.textContent = 'Saving…';
      statusEl.textContent = '';
      var body = {
        title: (document.getElementById('wb-form-title').value || '').trim(),
        nextAction: (document.getElementById('wb-form-next').value || '').trim(),
        description: (document.getElementById('wb-form-desc').value || '').trim(),
        area: (document.getElementById('wb-form-area') || { value: 'operations' }).value,
        priority: (document.getElementById('wb-form-priority') || { value: 'normal' }).value,
        dueDate: (document.getElementById('wb-form-due') || { value: '' }).value,
        githubUrl: (document.getElementById('wb-form-gh') || { value: '' }).value.trim(),
        status: (document.getElementById('wb-form-status') || { value: 'intake' }).value
      };
      var express = !!(document.getElementById('wb-form-express') || {}).checked;
      body.express = express;
      if (express) body.expressReason = (document.getElementById('wb-form-express-reason-input') || { value: '' }).value.trim();
      try {
        if (cardId) { await api('/api/workboard/' + cardId, { method: 'POST', body: body }); toast('Card updated.'); }
        else { await api('/api/workboard', { method: 'POST', body: body }); toast('Card created.'); }
        closeModal();
        await load();
      } catch (err) {
        statusEl.textContent = err.message;
        toast(err.message, true);
      } finally {
        save.disabled = false;
        save.textContent = cardId ? 'Save Changes' : 'Create Card';
      }
    });
  }

  function closeModal() {
    var m = document.getElementById('wb-modal');
    if (m) m.remove();
  }


  async function toggleExpress(id) {
    var card = _cache.find(function (c) { return c.id === id; });
    if (!card) return;
    var body = {};
    if (card.express) {
      body.express = false;
    } else {
      var reason = window.prompt('Express Lane (same-day blocker). Why must this be resolved today?');
      if (!reason || !reason.trim()) { toast('A reason is required for Express Lane.', true); return; }
      body.express = true;
      body.expressReason = reason.trim();
    }
    try {
      await api('/api/workboard/' + id, { method: 'POST', body: body });
      toast(card.express ? 'Removed from Express Lane.' : 'Added to Express Lane.');
      await load();
    } catch (err) { toast(err.message, true); }
  }

  async function deleteCard(id) {
    if (!window.confirm('Remove this card? This cannot be undone.')) return;
    try {
      await api('/api/workboard/' + id, { method: 'POST', body: { status: 'done' } });
      toast('Card moved to Done.');
      await load();
    } catch (err) { toast(err.message, true); }
  }

  async function load() {
    var root = document.getElementById('workboard-root');
    if (!root) return;
    try {
      var data = await api('/api/workboard');
      _cache = data.items || [];
      _meta = {
        statuses: data.statuses || ['intake', 'ready', 'doing', 'waiting', 'review', 'done'],
        priorities: data.priorities || ['low', 'normal', 'high'],
        areas: data.areas || ['sales', 'operations', 'support', 'compliance', 'marketing', 'product', 'other'],
        express: data.express || { capacity: 3 }
      };
      renderBoard();
    } catch (err) {
      root.innerHTML = '<div class="card"><h2>🗂️ Workboard</h2><div class="empty">Could not load Workboard: ' + esc(err.message) + '</div></div>';
    }
  }

  var OmniTenderWorkboard = {
    init: function () {
      _currentUserRole = sessionStorage.getItem('omni_dash_role') || 'Employee';
      _currentUser = sessionStorage.getItem('omni_dash_username') || '';
      load();
    }
  };

  window.OmniTenderWorkboard = OmniTenderWorkboard;
})();

