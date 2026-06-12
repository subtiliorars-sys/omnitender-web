/* OmniTender CRM Dashboard JS — Unified console logic
 * API: https://omnitender-omniverse.fly.dev (or relative for same-origin backend)
 * Token: sessionStorage only
 */

(function () {
  'use strict';

  // Autodetect if we are running on the Fly backend directly or on the static site
  var API = window.location.hostname === 'omnitender-omniverse.fly.dev' || window.location.port === '3000'
    ? ''
    : 'https://omnitender-omniverse.fly.dev';

  var REFRESH_MS = 30000;
  var _refreshTimer = null;
  var currentUserRole = 'Employee';
  var cachePipeline = [];
  var cacheLeads = [];

  /* ---- token helpers ---- */
  function getToken() {
    return sessionStorage.getItem('omni_dash_token') || '';
  }
  function setToken(t) {
    sessionStorage.setItem('omni_dash_token', t);
  }
  function clearToken() {
    sessionStorage.removeItem('omni_dash_token');
    sessionStorage.removeItem('omni_dash_role');
    sessionStorage.removeItem('omni_dash_username');
  }

  /* ---- view switching ---- */
  function showUnlock(errMsg) {
    document.getElementById('dash-view').style.display = 'none';
    document.getElementById('unlock-view').style.display = 'block';
    var errEl = document.getElementById('unlock-err');
    if (errMsg) {
      errEl.textContent = errMsg;
      errEl.style.display = 'block';
    } else {
      errEl.style.display = 'none';
    }
    stopRefresh();
  }

  function showDash() {
    document.getElementById('unlock-view').style.display = 'none';
    document.getElementById('dash-view').style.display = 'block';
  }

  /* ---- fetch helpers ---- */
  function authHeaders() {
    return { 'Authorization': 'Bearer ' + getToken() };
  }

  async function api(path, opts) {
    const o = opts || {};
    const init = { method: o.method || 'GET', headers: authHeaders() };
    if (init.method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-OV-Console'] = '1';
      init.body = JSON.stringify(o.body || {});
    }
    const r = await fetch(API + path, init);
    if (r.status === 401) {
      clearToken();
      showUnlock('Session expired. Please log in again.');
      throw new Error('Unauthorized');
    }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
    return data;
  }

  /* ---- HTML escape ---- */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#47;');
  }

  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3500);
  }

  /* ---- tabs ---- */
  const loaders = {
    overview: loadOverview,
    ledger: loadLedger,
    pipeline: loadPipeline,
    leads: loadLeads,
    feedback: loadFeedback,
    access: loadAccess,
    savings: loadPricing,
    digest: loadDigest
  };

  document.getElementById('nav').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + b.dataset.v));
    loaders[b.dataset.v]();
  });

  /* ---- Overview ---- */
  async function loadOverview() {
    try {
      const h = await api('/health');
      document.getElementById('health').innerHTML = h.status === 'ok'
        ? '<span class=up>● UP</span> — bot online (' + (h.channels || []).map(esc).join(', ') + ')'
        : '<span class=down>● issue</span>';
    } catch (e) { document.getElementById('health').innerHTML = '<span class=down>● UNREACHABLE</span>'; }
    try {
      const sj = await api('/stats');
      const s = sj.counts || {};
      const m = [['leads','Leads'],['onboarding','Onboarding'],['tickets','Tickets'],['calls','Calls']];
      document.getElementById('stats').innerHTML = m.map(([k,l]) => '<div class=stat><div class=n>' + (s[k] || 0) + '</div><div class=l>' + l + '</div></div>').join('');
      const tw = sj.twilio || {}, bar = document.getElementById('alertbar');
      if (tw.ok === false) { bar.style.display = 'block'; bar.textContent = '⚠ Twilio credentials rejected (error ' + esc(String(tw.code || '')) + ') — SMS offline.'; }
      else if (tw.ok === null && tw.code === 'no_credentials') { bar.style.display = 'block'; bar.textContent = '⚠ Twilio credentials not configured.'; }
      else { bar.style.display = 'none'; }
    } catch (e) {}
    try { document.getElementById('queue').textContent = await api('/queue'); } catch (e) {}
    loadAuditLogs();
    
    // Render pipeline distribution chart
    try {
      const pj = await api('/api/pipeline');
      const items = pj.items || [];
      const counts = { applied: 0, in_review: 0, approved: 0, hardware_sent: 0, active: 0, rejected: 0 };
      items.forEach(item => {
        if (counts[item.stage] !== undefined) counts[item.stage]++;
      });
      document.getElementById('pipeline-chart').innerHTML = renderSVGChart(counts);
    } catch (err) {
      document.getElementById('pipeline-chart').innerHTML = '<div class=empty>Failed to render chart: ' + esc(err.message) + '</div>';
    }
  }

  function renderSVGChart(counts) {
    const stages = ['applied', 'in_review', 'approved', 'hardware_sent', 'active', 'rejected'];
    const labels = ['Applied', 'In Review', 'Approved', 'Hardware Sent', 'Active', 'Rejected'];
    const colors = ['#F7792C', '#FFA066', '#D4AF37', '#FFC890', '#FFE1C2', '#a1a1a1'];
    
    const maxCount = Math.max(...stages.map(s => counts[s] || 0), 1);
    
    let svg = '<svg viewBox="0 0 600 220" width="100%" height="100%" style="font-family: inherit;">';
    
    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = 20 + i * 40;
      const val = Math.round(maxCount - (i * maxCount / 4));
      svg += '<line x1="50" y1="' + y + '" x2="570" y2="' + y + '" stroke="var(--card-edge)" stroke-dasharray="4" />';
      svg += '<text x="15" y="' + (y + 4) + '" font-size="10" fill="var(--muted)" font-weight="700">' + val + '</text>';
    }
    
    // Draw bars
    stages.forEach((stage, idx) => {
      const count = counts[stage] || 0;
      const barHeight = (count / maxCount) * 160;
      const x = 70 + idx * 85;
      const y = 180 - barHeight;
      const color = colors[idx];
      
      // Bar background (shadow)
      svg += '<rect x="' + x + '" y="20" width="40" height="160" fill="rgba(255,255,255,0.02)" rx="4" />';
      
      // Real bar
      svg += '<rect x="' + x + '" y="' + y + '" width="40" height="' + barHeight + '" fill="' + color + '" rx="4" style="transition: height 0.5s ease, y 0.5s ease;">' +
                '<title>' + labels[idx] + ': ' + count + '</title>' +
              '</rect>';
              
      // Value label on top of bar
      if (count > 0) {
        svg += '<text x="' + (x + 20) + '" y="' + (y - 6) + '" font-size="11" font-weight="bold" fill="var(--text)" text-anchor="middle">' + count + '</text>';
      }
      
      // X Axis Label
      svg += '<text x="' + (x + 20) + '" y="198" font-size="10" font-weight="bold" fill="var(--muted)" text-anchor="middle">' + labels[idx] + '</text>';
    });
    
    // Axis line
    svg += '<line x1="50" y1="180" x2="570" y2="180" stroke="var(--card-edge)" stroke-width="2" />';
    
    svg += '</svg>';
    return svg;
  }

  /* ---- Pipeline ---- */
  const NEXT_LABEL = { applied: 'Approve', in_review: 'Approve', approved: 'Advance → hardware', hardware_sent: 'Advance → active' };
  function pipeItem(o, closed) {
    const itemId = 'pi-' + esc(o.shortId);
    let detail = [o.business, o.phone, o.source ? 'via ' + o.source : ''].filter(Boolean).join(' · ');
    let html = '<div class="disc-item" id="' + itemId + '">' +
      '<div class="disc-summary">' +
      '<span class="chev">▶</span>' +
      '<span class="t">' + esc(o.name) +
        '<span class="badge b-' + esc(o.stage) + '">' + esc(o.stage.replace('_', ' ')) + '</span>' +
      '</span>' +
      '<span class="m">' + esc(o.shortId) + (detail ? ' · ' + esc(detail) : '') + '</span>' +
      '</div>' +
      '<div class="disc-body">';
    html += '<div class="m" style="margin-bottom:8px">' +
      'id ' + esc(o.shortId) +
      (o.business ? ' · ' + esc(o.business) : '') +
      (o.phone ? ' · ' + esc(o.phone) : '') +
      (o.source ? ' · via ' + esc(o.source) : '') +
      '</div>';
      
    // Render History Audit Logs
    if (o.history && o.history.length) {
      html += '<div style="margin-top: 12px; border-top: 1px dashed var(--card-edge); padding-top: 8px; margin-bottom: 12px;">' +
        '<span style="font-size: 11px; font-weight: 700; color: var(--accent); text-transform: uppercase;">Activity Log</span>' +
        '<div style="font-size: 11.5px; color: var(--muted); margin-top: 4px; line-height: 1.5;">' +
        o.history.map(function(h) {
          const d = new Date(h.at);
          const formattedDate = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
          return '<div style="margin-bottom: 3px;">• <strong>' + esc(formattedDate) + '</strong>: stage changed from <code>' + esc(h.from) + '</code> to <code>' + esc(h.stage) + '</code> by <em>' + esc(h.operator) + '</em></div>';
        }).join('') +
        '</div></div>';
    }

    html += '<div class="actions" style="margin-top:12px;">';
    if (!closed) {
      const goAction = (o.stage === 'applied' || o.stage === 'in_review') ? 'approve' : 'advance';
      html += '<button class="btn btn-go" data-act="' + goAction + '" data-id="' + esc(o.shortId) + '" data-name="' + esc(o.name) + '">' + (NEXT_LABEL[o.stage] || 'Advance') + '</button>' +
        '<button class="btn btn-no" data-act="reject" data-id="' + esc(o.shortId) + '" data-name="' + esc(o.name) + '">Reject</button>';
    }
    html += '<button class="btn btn-secondary btn-modal" data-modal-type="pipeline" data-modal-id="' + esc(o.shortId) + '" style="margin-left:8px; margin-top: 0; min-height: 34px; padding: 0 12px;">🔍 Details</button></div>';
    return html + '</div></div>';
  }

  function renderPipelineList() {
    const searchVal = document.getElementById('pipe-search').value.toLowerCase().trim();
    const stageVal = document.getElementById('pipe-filter-stage').value;
    
    const filtered = cachePipeline.filter(o => {
      const matchSearch = !searchVal || o.name.toLowerCase().includes(searchVal) || 
                          (o.business && o.business.toLowerCase().includes(searchVal)) || 
                          o.shortId.toLowerCase().includes(searchVal);
      const matchStage = !stageVal || o.stage === stageVal;
      return matchSearch && matchStage;
    });

    const open = filtered.filter((o) => o.stage !== 'active' && o.stage !== 'rejected');
    const closed = filtered.filter((o) => o.stage === 'active' || o.stage === 'rejected');

    document.getElementById('pipe').innerHTML = open.length 
      ? open.map((o) => pipeItem(o, false)).join('') 
      : '<div class=empty>No matching open applications.</div>';
      
    document.getElementById('pipe-closed').innerHTML = closed.length 
      ? closed.slice(-10).reverse().map((o) => pipeItem(o, true)).join('') 
      : '<div class=empty>No matching closed applications.</div>';
  }

  async function loadPipeline() {
    try {
      const pj = await api('/api/pipeline');
      cachePipeline = pj.items || [];
      renderPipelineList();
    } catch (e) { document.getElementById('pipe').innerHTML = '<div class=empty>Failed to load: ' + esc(e.message) + '</div>'; }
  }

  /* ---- Leads ---- */
  function renderLeadsList() {
    const searchVal = document.getElementById('leads-search').value.toLowerCase().trim();
    
    const filtered = cacheLeads.filter(l => {
      return !searchVal || 
             (l.name && l.name.toLowerCase().includes(searchVal)) || 
             (l.phone && l.phone.toLowerCase().includes(searchVal)) || 
             (l.business && l.business.toLowerCase().includes(searchVal)) || 
             (l.source && l.source.toLowerCase().includes(searchVal));
    });

    const ls = filtered.map((l) =>
      '<div class="disc-item" id="lead-' + esc(l.id) + '">' +
      '<div class="disc-summary"><span class="chev">▶</span><span class="t">' + esc(l.name || '(no name)') + '</span><span class="m">' + esc(l.phone || '') + '</span></div>' +
      '<div class="disc-body">' +
        '<p><strong>Business:</strong> ' + esc(l.business || 'N/A') + '</p>' +
        '<p><strong>Notes:</strong> ' + esc(l.notes || 'N/A') + '</p>' +
        '<p><strong>Source:</strong> ' + esc(l.source || 'website') + '</p>' +
        '<p><strong>Date:</strong> ' + esc(l.createdAt || 'N/A') + '</p>' +
        '<div class="actions"><button class="btn btn-no" data-erase="' + esc(l.id) + '" data-name="' + esc(l.name) + '">Erase Lead PII (M-7)</button>' +
        '<button class="btn btn-secondary btn-modal" data-modal-type="lead" data-modal-id="' + esc(l.id) + '" style="margin-left:8px; margin-top: 0; min-height: 34px; padding: 0 12px;">🔍 Details</button></div>' +
      '</div></div>'
    );
    document.getElementById('leadlist').innerHTML = cacheLeads.length 
      ? (filtered.length + ' shown (' + cacheLeads.length + ' total) — latest:' + ls.join('')) 
      : '<div class=empty>No leads yet.</div>';
  }

  async function loadLeads() {
    try {
      const lj = await api('/leads');
      cacheLeads = lj.leads || [];
      renderLeadsList();
    } catch (e) { document.getElementById('leadlist').innerHTML = '<div class=empty>Failed to load: ' + esc(e.message) + '</div>'; }
  }

  /* ---- Feedback ---- */
  var cacheFeedback = [];

  function feedbackStatusBadge(status) {
    const s = status || 'new';
    const colors = {
      new: '#F7792C',
      reviewing: '#60a5fa',
      accepted: '#34d399',
      declined: '#f87171',
      done: '#a1a1a1'
    };
    return '<span style="display:inline-block; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.06); color:' + (colors[s] || colors.new) + ';">' + esc(s) + '</span>';
  }

  function renderFeedbackList() {
    const filter = (document.getElementById('feedback-filter') || {}).value || '';
    const list = filter ? cacheFeedback.filter((f) => (f.status || 'new') === filter) : cacheFeedback;
    const el = document.getElementById('feedback-list');
    if (!list.length) {
      el.innerHTML = '<div class="empty">' + (filter ? 'No feedback with that status.' : 'No feedback yet — reports from the site will appear here.') + '</div>';
      return;
    }
    el.innerHTML = list.map(function (f) {
      const cat = f.category || 'bug';
      const catLabel = cat === 'improvement' ? '✨ Improvement' : cat === 'question' ? '❓ Question' : '🐞 Bug';
      const when = f.at ? new Date(f.at).toLocaleString() : '';
      const ctx = f.context ? '<div style="font-size:11px; color:var(--faint); margin-top:6px; word-break:break-all;">Page: ' + esc(f.context) + '</div>' : '';
      const shot = f.screenshot ? '<details style="margin-top:8px;"><summary style="cursor:pointer; font-size:11px; color:var(--accent);">View screenshot</summary><img src="' + esc(f.screenshot) + '" alt="Feedback screenshot" style="max-width:100%; margin-top:8px; border-radius:8px; border:1px solid var(--card-edge);"></details>' : '';
      const note = f.reviewNote ? '<div style="font-size:11px; color:var(--muted); margin-top:8px;">Note: ' + esc(f.reviewNote) + '</div>' : '';
      const actions = (f.status === 'done' || f.status === 'declined')
        ? '<button class="btn" data-fb-status="' + esc(f.id) + '" data-status="reviewing" style="width:auto; min-height:0; padding:6px 10px; font-size:11px; margin:0;">Reopen</button>'
        : '<div style="display:flex; gap:6px; flex-wrap:wrap;">' +
            '<button class="btn btn-go" data-fb-status="' + esc(f.id) + '" data-status="accepted" style="width:auto; min-height:0; padding:6px 10px; font-size:11px; margin:0;">Accept</button>' +
            '<button class="btn" data-fb-status="' + esc(f.id) + '" data-status="reviewing" style="width:auto; min-height:0; padding:6px 10px; font-size:11px; margin:0;">Reviewing</button>' +
            '<button class="btn btn-no" data-fb-status="' + esc(f.id) + '" data-status="declined" style="width:auto; min-height:0; padding:6px 10px; font-size:11px; margin:0;">Decline</button>' +
            '<button class="btn" data-fb-status="' + esc(f.id) + '" data-status="done" style="width:auto; min-height:0; padding:6px 10px; font-size:11px; margin:0;">Mark Done</button>' +
          '</div>';
      return '<div class="card" style="margin-bottom:12px; padding:14px;">' +
        '<div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start; flex-wrap:wrap;">' +
          '<div><strong>' + catLabel + '</strong> ' + feedbackStatusBadge(f.status) + '</div>' +
          '<span style="font-size:11px; color:var(--faint);">' + esc(when) + '</span>' +
        '</div>' +
        '<p style="margin:10px 0 0; font-size:13px; line-height:1.5; white-space:pre-wrap;">' + esc(f.message) + '</p>' +
        ctx + shot + note +
        '<div style="margin-top:12px;">' + actions + '</div>' +
      '</div>';
    }).join('');
  }

  async function loadFeedback() {
    try {
      const data = await api('/api/feedback');
      cacheFeedback = data.items || [];
      renderFeedbackList();
    } catch (err) {
      document.getElementById('feedback-list').innerHTML = '<div class="empty">Could not load feedback: ' + esc(err.message) + '</div>';
    }
  }

  document.getElementById('feedback-filter').addEventListener('change', renderFeedbackList);

  document.getElementById('feedback-list').addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-fb-status]');
    if (!btn) return;
    const id = btn.getAttribute('data-fb-status');
    const status = btn.getAttribute('data-status');
    btn.disabled = true;
    try {
      await api('/api/feedback/action', { method: 'POST', body: { id, status } });
      toast('Feedback marked as ' + status + '.');
      loadFeedback();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });

  /* ---- Access & Users ---- */
  async function loadAccess() {
    try {
      const aj = await api('/api/access');
      const inv = (aj.invites || []).slice().reverse().map((i) => {
        const st = i.revoked ? 'revoked' : (i.redeemed ? 'redeemed' : 'open');
        return '<div class="item"><div class="t">' + esc(i.code) +
          '<span class="badge b-' + st + '">' + st + '</span></div>' +
          '<div class="m">' + [i.note, i.createdAt ? i.createdAt.slice(0, 10) : ''].filter(Boolean).map(esc).join(' · ') + '</div>' +
          (st === 'open' ? '<div class="actions" style="margin-top:4px"><button class="btn btn-no" data-revoke="' + esc(i.code) + '">Revoke</button></div>' : '') +
          '</div>';
      });
      document.getElementById('invites').innerHTML = inv.length ? inv.join('') : '<div class=empty>No invites minted yet.</div>';
      
      const us = (aj.users || []).map((u) =>
        '<div class="item"><div class="t">…' + esc(u.phone) + '</div><div class="m">' +
        ['joined ' + (u.joinedAt ? u.joinedAt.slice(0, 10) : '?'), u.invitedVia ? 'via ' + u.invitedVia : '']
          .filter(Boolean).map(esc).join(' · ') + '</div></div>');
      document.getElementById('users').innerHTML = us.length ? us.join('') : '<div class=empty>No registered users yet.</div>';
    } catch (e) { document.getElementById('invites').innerHTML = '<div class=empty>Failed to load invites: ' + esc(e.message) + '</div>'; }

    // Load console users if Admin
    if (currentUserRole === 'Admin') {
      document.getElementById('admin-user-mgmt').style.display = 'block';
      try {
        const uj = await api('/api/console_users');
        const cul = (uj.users || []).map((u) =>
          '<div class="item"><div class="t">' + esc(u.username) +
          '<span class="badge b-approved">' + esc(u.role) + '</span></div>' +
          '<div class="m">Created ' + esc(u.createdAt.slice(0, 10)) + '</div>' +
          (u.username.toLowerCase() !== 'admin' ? '<div class="actions" style="margin-top:4px"><button class="btn btn-no" data-deluser="' + esc(u.id) + '" data-uname="' + esc(u.username) + '">Delete</button></div>' : '') +
          '</div>'
        );
        document.getElementById('console-users-list').innerHTML = cul.length ? cul.join('') : '<div class=empty>No custom accounts created yet.</div>';
      } catch (e) { document.getElementById('console-users-list').innerHTML = '<div class=empty>Failed to load accounts.</div>'; }
    } else {
      document.getElementById('admin-user-mgmt').style.display = 'none';
    }
  }

  /* ---- Savings ---- */
  async function loadPricing() {
    try {
      const p = await api('/api/pricing');
      const labels = {
        defaultRatePct: 'Default total rate (%) — starting point',
        servicerPct: 'Crypto servicer % per transaction (cost floor)',
        servicerFixed: 'Crypto servicer fixed $ per transaction',
        terminalCryptoOnly: 'Crypto-only terminal $ (incl. tax + shipping)',
        terminalFull: 'Crypto + debit/credit/EBT terminal $ (incl. tax + shipping)',
      };
      document.getElementById('pr-fields').innerHTML = Object.keys(labels).map((k) =>
        '<div style="margin-bottom:8px"><div class="m" style="margin-bottom:3px;font-size:12px;color:var(--muted)">' + labels[k] + '</div>' +
        '<input type="text" inputmode="decimal" data-pr="' + k + '" value="' + esc(p[k]) + '"></div>').join('');
      if (p.updatedAt) document.getElementById('pr-meta').textContent = 'Last adjusted ' + p.updatedAt.slice(0, 10);
    } catch (e) { document.getElementById('pr-fields').innerHTML = '<div class=empty>Failed to load pricing.</div>'; }
  }

  /* ---- Digest ---- */
  var cacheDigestSettings = null;
  async function loadDigestSettings() {
    try {
      const settings = await api('/api/digest/settings');
      cacheDigestSettings = settings;
      document.getElementById('digest-email-sub').checked = !!settings.enabled;
      document.getElementById('digest-email-input').value = settings.email || '';
    } catch (err) {
      console.warn('Failed to load digest settings:', err);
    }
  }

  async function loadDigest() {
    loadDigestSettings();
    try {
      const pass = document.getElementById('digest-pass-input').value;
      const headers = pass ? { 'x-digest-password': pass } : {};
      const queryStr = pass ? '?password=' + encodeURIComponent(pass) : '';
      
      const response = await fetch(API + '/digest' + queryStr, { headers: Object.assign(authHeaders(), headers) });
      if (response.status === 401) {
        document.getElementById('digest').textContent = 'Daily Digest Report is locked/encrypted. Please enter your Password below to decrypt and view.';
        return;
      }
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || ('HTTP ' + response.status));
      }
      const text = await response.text();
      document.getElementById('digest').textContent = text;
    } catch (e) {
      document.getElementById('digest').textContent = 'Failed to load digest: ' + e.message;
    }
  }

  /* ---- Actions ---- */
  document.getElementById('v-pipeline').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const { act, id, name } = b.dataset;
    if (!confirm(act.toUpperCase() + ' ' + name + ' (id ' + id + ')?')) return;
    b.disabled = true;
    try {
      const r = await api('/api/pipeline/action', { method: 'POST', body: { id, action: act } });
      toast(r.message || 'Done.');
    } catch (err) { toast(err.message, true); }
    loadPipeline();
  });

  document.getElementById('v-leads').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-erase]'); if (!b) return;
    const { erase, name } = b.dataset;
    if (!confirm('ERASE ALL PII for ' + name + '? This is irreversible.')) return;
    b.disabled = true;
    try {
      const r = await api('/api/leads/' + erase + '/erasure', { method: 'POST' });
      toast('Lead erased. Receipt: ' + r.receipt);
    } catch (err) { toast(err.message, true); }
    loadLeads();
  });

  document.getElementById('v-access').addEventListener('click', async (e) => {
    // Revoke Invite
    const revokeBtn = e.target.closest('button[data-revoke]');
    if (revokeBtn) {
      const code = revokeBtn.dataset.revoke;
      if (!confirm('Revoke invite ' + code + '?')) return;
      revokeBtn.disabled = true;
      try {
        await api('/api/invites/revoke', { method: 'POST', body: { code } });
        toast('Invite ' + code + ' revoked.');
      } catch (err) { toast(err.message, true); }
      loadAccess();
      return;
    }

    // Delete Console User
    const delBtn = e.target.closest('button[data-deluser]');
    if (delBtn) {
      const { deluser, uname } = delBtn.dataset;
      if (!confirm('Delete console account for ' + uname + '?')) return;
      delBtn.disabled = true;
      try {
        await api('/api/console_users/delete', { method: 'POST', body: { id: deluser } });
        toast('Account deleted.');
      } catch (err) { toast(err.message, true); }
      loadAccess();
      return;
    }
  });

  document.getElementById('invite-mint').addEventListener('click', async () => {
    const note = document.getElementById('invite-note').value.trim();
    document.getElementById('invite-mint').disabled = true;
    try {
      const r = await api('/api/invites', { method: 'POST', body: { note } });
      toast('Invite ' + r.code + ' minted.');
      document.getElementById('invite-note').value = '';
    } catch (err) { toast(err.message, true); }
    document.getElementById('invite-mint').disabled = false;
    loadAccess();
  });

  document.getElementById('console-user-create').addEventListener('click', async () => {
    const username = document.getElementById('console-username').value.trim();
    const password = document.getElementById('console-password').value.trim();
    const role = document.getElementById('console-role').value;
    if (!username || !password) { toast('Username and password required.', true); return; }

    document.getElementById('console-user-create').disabled = true;
    try {
      await api('/api/console_users', { method: 'POST', body: { username, password, role } });
      toast('User account ' + username + ' created.');
      document.getElementById('console-username').value = '';
      document.getElementById('console-password').value = '';
    } catch (err) { toast(err.message, true); }
    document.getElementById('console-user-create').disabled = false;
    loadAccess();
  });

  document.getElementById('sv-calc').addEventListener('click', async () => {
    const out = document.getElementById('sv-result');
    const numVal = (id) => document.getElementById(id).value.replace(/[$,%]/g, '').trim();
    const q = '/api/savings?volume=' + encodeURIComponent(numVal('sv-volume')) +
      '&fees=' + encodeURIComponent(numVal('sv-fees')) +
      '&rate=' + encodeURIComponent(numVal('sv-rate')) +
      '&avgSale=' + encodeURIComponent(numVal('sv-avgsale')) +
      '&terminal=' + encodeURIComponent(document.getElementById('sv-terminal').value);
    try {
      const r = await api(q);
      let html = '<div class="grid">' +
        '<div class=stat><div class=n>' + esc(r.ratePct) + '%</div><div class=l>Effective rate</div></div>' +
        '<div class=stat><div class=n>' + money(r.monthlySavings) + '</div><div class=l>Saved / mo</div></div>' +
        '<div class=stat><div class=n>' + money(r.annualSavings) + '</div><div class=l>Saved / yr</div></div>' +
        (r.terminalCost ? '<div class=stat><div class=n>' + money(r.terminalCost) + '</div><div class=l>Terminal cost</div></div>' : '') +
        '</div>';
      out.innerHTML = html;
    } catch (err) { out.innerHTML = '<div class=empty>' + esc(err.message) + '</div>'; }
  });

  document.getElementById('pr-save').addEventListener('click', async () => {
    const body = {};
    document.querySelectorAll('[data-pr]').forEach((i) => { body[i.dataset.pr] = i.value.replace(/[$,%]/g, '').trim(); });
    document.getElementById('pr-save').disabled = true;
    try {
      await api('/api/pricing', { method: 'POST', body });
      toast('Pricing saved.');
    } catch (err) { toast(err.message, true); }
    document.getElementById('pr-save').disabled = false;
    loadPricing();
  });

  /* ---- login flow ---- */
  var tempLoginCreds = null; // Stash username/password for MFA challenge step
  document.getElementById('unlock-btn').addEventListener('click', async function () {
    var user = document.getElementById('username-input').value.trim();
    var pass = document.getElementById('token-input').value.trim();
    var mfaCode = document.getElementById('login-mfa-input').value.trim();
    if (!pass) { toast('Please enter password or token.', true); return; }

    var btn = document.getElementById('unlock-btn');
    btn.disabled = true;
    btn.textContent = 'Logging in…';

    try {
      const payload = { username: user || 'admin', password: pass };
      if (mfaCode) payload.mfaCode = mfaCode;
      
      const res = await fetch(API + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');

      // If MFA is required to login, show the input box and let user try again with code
      if (data.mfaRequired) {
        tempLoginCreds = { user, pass };
        document.getElementById('login-mfa-box').style.display = 'block';
        toast('MFA code required to authenticate.', false);
        document.getElementById('login-mfa-input').focus();
        return;
      }

      // Check if First Login Setup is mandated
      if (data.mustSetupMfa) {
        setToken(data.token);
        sessionStorage.setItem('omni_dash_role', data.role);
        sessionStorage.setItem('omni_dash_username', data.username);
        currentUserRole = data.role;

        document.getElementById('mfa-setup-username').value = data.username;
        document.getElementById('mfa-secret-text').textContent = 'Loading…';
        document.getElementById('mfa-qr-placeholder').innerHTML = 'Loading QR…';
        document.getElementById('mfa-setup-modal').style.display = 'flex';

        try {
          const setup = await api('/api/console_users/mfa-setup');
          document.getElementById('mfa-secret-text').textContent = setup.secret || 'Unavailable';
          if (setup.otpauthUri) {
            document.getElementById('mfa-qr-placeholder').innerHTML =
              '<img src="https://quickchart.io/qr?size=140&margin=1&text=' + encodeURIComponent(setup.otpauthUri) + '" alt="Scan to add authenticator" width="140" height="140" style="display:block;">';
          } else {
            document.getElementById('mfa-qr-placeholder').textContent = 'Enter key manually below';
          }
        } catch (setupErr) {
          document.getElementById('mfa-secret-text').textContent = 'Could not load — contact admin';
          document.getElementById('mfa-qr-placeholder').textContent = setupErr.message;
        }
        return;
      }

      setToken(data.token);
      sessionStorage.setItem('omni_dash_role', data.role);
      sessionStorage.setItem('omni_dash_username', data.username);
      currentUserRole = data.role;

      // Clean up form inputs
      document.getElementById('token-input').value = '';
      document.getElementById('username-input').value = '';
      document.getElementById('login-mfa-input').value = '';
      document.getElementById('login-mfa-box').style.display = 'none';
      tempLoginCreds = null;

      showDash();
      loadOverview();
      startRefresh();
      toast('Welcome back, ' + data.username);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });

  // --- First Login MFA setup submit binding ---
  document.getElementById('mfa-setup-submit').addEventListener('click', async function() {
    const newUsername = document.getElementById('mfa-setup-username').value.trim();
    const newPassword = document.getElementById('mfa-setup-password').value.trim();
    const mfaCode = document.getElementById('mfa-verification-code').value.trim();
    const errDiv = document.getElementById('mfa-setup-err');

    if (!newPassword || !/^\d{6,12}$/.test(newPassword)) {
      errDiv.textContent = 'PIN must be a numeric code between 6 and 12 digits.';
      errDiv.style.display = 'block';
      return;
    }
    if (!mfaCode) {
      errDiv.textContent = 'Verification code is required.';
      errDiv.style.display = 'block';
      return;
    }

    errDiv.style.display = 'none';
    const btn = document.getElementById('mfa-setup-submit');
    btn.disabled = true;
    btn.textContent = 'Verifying security configuration...';

    try {
      const res = await api('/api/console_users/setup-mfa', {
        method: 'POST',
        body: { newUsername, newPassword, mfaCode }
      });
      
      toast('Security setup complete. Account activated!');
      document.getElementById('mfa-setup-modal').style.display = 'none';
      
      // Clean up form inputs
      document.getElementById('token-input').value = '';
      document.getElementById('username-input').value = '';
      document.getElementById('mfa-setup-password').value = '';
      document.getElementById('mfa-verification-code').value = '';

      showDash();
      loadOverview();
      startRefresh();
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify Code & Activate Account';
    }
  });

  /* ---- auto-refresh & lock ---- */
  function startRefresh() {
    stopRefresh();
    _refreshTimer = setInterval(loadOverview, REFRESH_MS);
  }
  function stopRefresh() {
    if (_refreshTimer !== null) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  // Inactivity tracking (15 minutes) with 1 minute warning
  var INACTIVITY_TIMEOUT = 15 * 60 * 1000;
  var WARNING_TIME = 14 * 60 * 1000;
  var _inactivityTimer = null;
  var _warningTimer = null;
  var _countdownInterval = null;

  function resetInactivityTimer() {
    if (getToken()) {
      clearTimeout(_inactivityTimer);
      clearTimeout(_warningTimer);
      clearInterval(_countdownInterval);
      
      const banner = document.getElementById('session-warning-banner');
      if (banner) banner.style.display = 'none';
      
      _warningTimer = setTimeout(showSessionWarning, WARNING_TIME);
      _inactivityTimer = setTimeout(autoLock, INACTIVITY_TIMEOUT);
    }
  }

  function showSessionWarning() {
    const banner = document.getElementById('session-warning-banner');
    if (!banner) return;
    banner.style.display = 'flex';
    
    let remaining = 60;
    const remainingEl = document.getElementById('session-time-remaining');
    if (remainingEl) remainingEl.textContent = remaining;
    
    clearInterval(_countdownInterval);
    _countdownInterval = setInterval(() => {
      remaining--;
      if (remainingEl) remainingEl.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(_countdownInterval);
      }
    }, 1000);
  }

  async function autoLock() {
    toast('Logged out due to inactivity.', true);
    await performLogout();
  }

  async function performLogout() {
    const token = getToken();
    if (token) {
      try {
        await fetch(API + '/api/logout', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'X-OV-Console': '1'
          }
        });
      } catch (err) {
        console.warn('Network logout failed:', err);
      }
    }
    clearToken();
    showUnlock('You have been logged out.');
  }

  document.getElementById('lock-btn').addEventListener('click', async function () {
    await performLogout();
  });

  // Track activity to reset timer
  ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(name => {
    document.addEventListener(name, resetInactivityTimer, true);
  });

  /* ---- Theme Management ---- */
  function getTheme() {
    return localStorage.getItem('omni_theme') || 'dark';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('omni_theme', theme);
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) {
      themeBtn.textContent = theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode';
    }
  }

  document.getElementById('theme-btn').addEventListener('click', function () {
    const current = getTheme();
    applyTheme(current === 'light' ? 'dark' : 'light');
  });

  document.getElementById('refresh-btn').addEventListener('click', function () {
    const activeBtn = document.querySelector('nav button.on');
    if (activeBtn && loaders[activeBtn.dataset.v]) {
      loaders[activeBtn.dataset.v]();
    }
  });

  /* ---- Search & Filter input bindings ---- */
  document.getElementById('pipe-search').addEventListener('input', renderPipelineList);
  document.getElementById('pipe-filter-stage').addEventListener('change', renderPipelineList);
  document.getElementById('leads-search').addEventListener('input', renderLeadsList);

  /* ---- CSV & JSON Exports ---- */
  document.getElementById('export-json-btn').addEventListener('click', function() {
    window.open(API + '/export?token=' + getToken(), '_blank');
  });
  document.getElementById('export-leads-btn').addEventListener('click', function() {
    window.open(API + '/api/export/leads?token=' + getToken(), '_blank');
  });
  document.getElementById('export-pipe-btn').addEventListener('click', function() {
    window.open(API + '/api/export/pipeline?token=' + getToken(), '_blank');
  });

  /* ---- Modal overlay triggers ---- */
  const modal = document.getElementById('details-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  
  document.getElementById('modal-close-btn').addEventListener('click', () => {
    modal.style.display = 'none';
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-modal');
    if (!btn) return;
    const type = btn.dataset.modalType;
    const id = btn.dataset.modalId;
    
    if (type === 'pipeline') {
      const item = cachePipeline.find(o => o.shortId === id);
      if (item) {
        modalTitle.innerHTML = esc(item.name) + ' <span class="badge b-' + esc(item.stage) + '">' + esc(item.stage.replace('_', ' ')) + '</span>';
        let bodyHtml = '<p><strong>Application ID:</strong> <code>' + esc(item.id) + '</code> (short: <code>' + esc(item.shortId) + '</code>)</p>' +
          '<p><strong>Business Type:</strong> ' + esc(item.business || 'N/A') + '</p>' +
          '<p><strong>Phone:</strong> ' + esc(item.phone || 'N/A') + '</p>' +
          '<p><strong>Source:</strong> ' + esc(item.source || 'N/A') + '</p>' +
          '<p><strong>Created:</strong> ' + esc(item.createdAt || 'N/A') + '</p>' +
          '<p><strong>Last Updated:</strong> ' + esc(item.updatedAt || 'N/A') + '</p>';
          
        if (item.history && item.history.length) {
          bodyHtml += '<div style="margin-top: 16px; border-top: 1px dashed var(--card-edge); padding-top: 12px;">' +
            '<h3 style="font-size:12.5px; text-transform:uppercase; color:var(--accent); margin:0 0 8px 0;">Pipeline Progression Log</h3>' +
            '<div style="font-size:12px; color:var(--muted); line-height:1.5;">' +
            item.history.map(function(h) {
              return '<div style="margin-bottom:6px;">• <strong>' + esc(new Date(h.at).toLocaleString()) + '</strong>: ' +
                'stage <code>' + esc(h.from) + '</code> ➡️ <code>' + esc(h.stage) + '</code> ' +
                'by operator <em>' + esc(h.operator) + '</em></div>';
            }).join('') +
            '</div></div>';
        }
        modalBody.innerHTML = bodyHtml;
        modal.style.display = 'flex';
      }
    } else if (type === 'lead') {
      const item = cacheLeads.find(l => l.id === id);
      if (item) {
        modalTitle.textContent = esc(item.name || 'Lead Details');
        let bodyHtml = '<p><strong>Lead ID:</strong> <code>' + esc(item.id) + '</code></p>' +
          '<p><strong>Phone:</strong> ' + esc(item.phone || 'N/A') + '</p>' +
          '<p><strong>Business:</strong> ' + esc(item.business || 'N/A') + '</p>' +
          '<p><strong>Consent Given:</strong> ' + (item.consent ? '<span class="up">Yes</span>' : '<span class="down">No</span>') + '</p>' +
          '<p><strong>Channel/Via:</strong> ' + esc(item.via || 'N/A') + '</p>' +
          '<p><strong>Source Form:</strong> ' + esc(item.source || 'N/A') + '</p>' +
          '<p><strong>Submitted:</strong> ' + esc(item.createdAt || 'N/A') + '</p>' +
          '<p style="margin-bottom: 4px;"><strong>Notes:</strong></p><pre style="font-size:12px; max-height:150px; overflow-y:auto;">' + esc(item.notes || 'None') + '</pre>';
        modalBody.innerHTML = bodyHtml;
        modal.style.display = 'flex';
      }
    }
  });

  /* ---- click disclosure items ---- */
  document.addEventListener('click', (e) => {
    // Prevent expanding details when clicking actions inside them
    if (e.target.closest('.actions')) return;
    const summary = e.target.closest('.disc-summary');
    if (!summary) return;
    const item = summary.closest('.disc-item');
    if (item) item.classList.toggle('open');
  });

  // --- Audit Logs Helpers & Render ---
  var cacheAuditLogs = [];
  async function loadAuditLogs() {
    try {
      const data = await api('/api/activity-logs');
      cacheAuditLogs = data.items || [];
      renderAuditLogs();
    } catch (e) {
      document.getElementById('audit-log-stream').innerHTML = '<div style="color:red;">Failed to load activity logs.</div>';
    }
  }

  function renderAuditLogs() {
    const searchVal = document.getElementById('audit-search').value.toLowerCase();
    const actionVal = document.getElementById('audit-filter-action').value;
    const container = document.getElementById('audit-log-stream');
    
    if (cacheAuditLogs.length === 0) {
      container.innerHTML = '<div style="color:var(--faint);">No activities logged.</div>';
      return;
    }
    
    const filtered = cacheAuditLogs.filter(log => {
      const matchSearch = !searchVal || 
        log.user.toLowerCase().includes(searchVal) || 
        log.action.toLowerCase().includes(searchVal) || 
        log.details.toLowerCase().includes(searchVal);
      const matchAction = !actionVal || log.action === actionVal;
      return matchSearch && matchAction;
    });
    
    if (filtered.length === 0) {
      container.innerHTML = '<div style="color:var(--faint);">No matching activities found.</div>';
      return;
    }
    
    container.innerHTML = filtered.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      const date = new Date(log.timestamp).toLocaleDateString();
      return `<div style="margin-bottom: 6px; border-bottom: 1px dashed #222; padding-bottom: 6px;">
        <span style="color:var(--accent);">[${date} ${time}]</span> 
        <strong style="color:var(--pos-gold);">${esc(log.user)}</strong> 
        <span style="color:#52a8ff; font-weight:bold;">${esc(log.action)}</span> - 
        <span style="color:#ccc;">${esc(log.details)}</span>
      </div>`;
    }).join('');
  }

  // --- Audit Filters Bindings ---
  document.getElementById('audit-search').addEventListener('input', renderAuditLogs);
  document.getElementById('audit-filter-action').addEventListener('change', renderAuditLogs);

  // --- CSV Import Binding ---
  document.getElementById('csv-import-btn').addEventListener('click', async function() {
    const fileInput = document.getElementById('csv-file-input');
    const statusDiv = document.getElementById('csv-import-status');
    if (!fileInput.files || fileInput.files.length === 0) {
      statusDiv.innerHTML = '<span style="color:red;">Please select a CSV file.</span>';
      return;
    }
    
    const file = fileInput.files[0];
    const reader = new FileReader();
    statusDiv.innerHTML = '<span style="color:var(--accent);">Parsing and uploading CSV...</span>';
    
    reader.onload = async function(e) {
      const csvText = e.target.result;
      try {
        const res = await api('/api/leads/import', {
          method: 'POST',
          body: { csv: csvText }
        });
        statusDiv.innerHTML = `<span style="color:#22c55e; font-weight:bold;">✓ Imported ${res.count} leads successfully!</span>`;
        fileInput.value = '';
        loadLeads();
      } catch (err) {
        statusDiv.innerHTML = `<span style="color:red;">Import failed: ${esc(err.message)}</span>`;
      }
    };
    reader.readAsText(file);
  });

  // --- Digest Subscription Settings Binding ---
  document.getElementById('digest-sub-save-btn').addEventListener('click', async function() {
    const email = document.getElementById('digest-email-input').value;
    const enabled = document.getElementById('digest-email-sub').checked;
    const password = document.getElementById('digest-pass-input').value;
    const statusDiv = document.getElementById('digest-sub-status');
    
    if (enabled && (!email || !password)) {
      statusDiv.innerHTML = '<span style="color:red;">Email and Password are required to subscribe.</span>';
      return;
    }
    
    statusDiv.innerHTML = '<span style="color:var(--accent);">Saving settings...</span>';
    try {
      await api('/api/digest/settings', {
        method: 'POST',
        body: { email, enabled, password }
      });
      statusDiv.innerHTML = '<span style="color:#22c55e;">✓ Subscription settings saved successfully!</span>';
      setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
      loadDigest();
    } catch (err) {
      statusDiv.innerHTML = `<span style="color:red;">Failed: ${esc(err.message)}</span>`;
    }
  });

  // --- Session Warning Banner Renewal Binding ---
  document.getElementById('session-renew-btn').addEventListener('click', async function() {
    resetInactivityTimer();
    try {
      await api('/stats');
      toast('Session extended.');
    } catch (e) {
      console.warn("Session renewal heartbeat failed", e);
    }
  });

  // --- Ledger Section (Mock Data, Renderer, Filters & Export) ---
  var cacheLedger = [
    { txid: 'TX_910293', timestamp: '2026-06-12T10:15:30Z', customer: 'Alice Smith', amount: 120.50, method: 'USDC (OmniTender)', feeSaved: 3.62, status: 'Completed' },
    { txid: 'TX_910292', timestamp: '2026-06-12T09:44:12Z', customer: 'Bob Jones', amount: 45.00, method: 'USDT (OmniTender)', feeSaved: 1.35, status: 'Completed' },
    { txid: 'TX_910291', timestamp: '2026-06-11T18:22:05Z', customer: 'Charlie Brown', amount: 350.00, method: 'Visa (Credit Card)', feeSaved: 0.00, status: 'Completed' },
    { txid: 'TX_910290', timestamp: '2026-06-11T14:10:45Z', customer: 'Diana Prince', amount: 85.20, method: 'USDC (OmniTender)', feeSaved: 2.56, status: 'Completed' },
    { txid: 'TX_910289', timestamp: '2026-06-10T11:05:00Z', customer: 'Evan Wright', amount: 220.00, method: 'Mastercard', feeSaved: 0.00, status: 'Completed' },
    { txid: 'TX_910288', timestamp: '2026-06-10T08:30:15Z', customer: 'Fiona Gallagher', amount: 15.75, method: 'EBT (SNAP)', feeSaved: 0.47, status: 'Completed' },
    { txid: 'TX_910287', timestamp: '2026-06-09T16:55:00Z', customer: 'George Costanza', amount: 62.10, method: 'USDC (OmniTender)', feeSaved: 1.86, status: 'Completed' },
    { txid: 'TX_910286', timestamp: '2026-06-09T12:04:10Z', customer: 'Hannah Abbott', amount: 110.00, method: 'USDT (OmniTender)', feeSaved: 3.30, status: 'Completed' },
    { txid: 'TX_910285', timestamp: '2026-06-08T15:30:00Z', customer: 'Ian Malcolm', amount: 420.00, method: 'Visa (Credit Card)', feeSaved: 0.00, status: 'Refunded' },
    { txid: 'TX_910284', timestamp: '2026-06-08T09:12:35Z', customer: 'Julia Roberts', amount: 95.50, method: 'USDC (OmniTender)', feeSaved: 2.87, status: 'Completed' },
    { txid: 'TX_910283', timestamp: '2026-06-07T14:40:20Z', customer: 'Kevin Bacon', amount: 300.00, method: 'EBT (SNAP)', feeSaved: 9.00, status: 'Completed' }
  ];

  async function loadLedger() {
    renderLedger();
  }

  function renderLedger() {
    const searchVal = document.getElementById('ledger-search').value.toLowerCase().trim();
    const sortVal = document.getElementById('ledger-sort').value;
    
    let filtered = cacheLedger.filter(item => {
      return !searchVal || 
             item.txid.toLowerCase().includes(searchVal) || 
             item.customer.toLowerCase().includes(searchVal) || 
             item.method.toLowerCase().includes(searchVal);
    });

    // Sort logic
    filtered.sort((a, b) => {
      if (sortVal === 'date-desc') {
        return new Date(b.timestamp) - new Date(a.timestamp);
      } else if (sortVal === 'date-asc') {
        return new Date(a.timestamp) - new Date(b.timestamp);
      } else if (sortVal === 'value-desc') {
        return b.amount - a.amount;
      } else if (sortVal === 'value-asc') {
        return a.amount - b.amount;
      } else if (sortVal === 'fee-desc') {
        return b.feeSaved - a.feeSaved;
      }
      return 0;
    });

    const tbody = document.getElementById('ledger-body');
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty" style="text-align:center; padding: 20px;">No matching transactions found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(o => {
      const d = new Date(o.timestamp);
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const statusClass = o.status === 'Completed' ? 'badge b-active' : 'badge b-rejected';
      return '<tr>' +
        '<td style="padding:10px; border-bottom: 1px solid var(--card-edge); font-family: monospace; font-weight: bold;">' + esc(o.txid) + '</td>' +
        '<td style="padding:10px; border-bottom: 1px solid var(--card-edge);">' + esc(dateStr) + '</td>' +
        '<td style="padding:10px; border-bottom: 1px solid var(--card-edge);">' + esc(o.customer) + '</td>' +
        '<td style="padding:10px; border-bottom: 1px solid var(--card-edge); font-weight: bold;">' + money(o.amount) + '</td>' +
        '<td style="padding:10px; border-bottom: 1px solid var(--card-edge);"><span class="badge b-approved" style="background: rgba(247, 121, 44, 0.1); color: var(--accent); border: 1px solid rgba(247, 121, 44, 0.2);">' + esc(o.method) + '</span></td>' +
        '<td style="padding:10px; border-bottom: 1px solid var(--card-edge); color: var(--up); font-weight: bold;">+' + money(o.feeSaved) + '</td>' +
        '<td style="padding:10px; border-bottom: 1px solid var(--card-edge);"><span class="' + statusClass + '">' + esc(o.status) + '</span></td>' +
        '</tr>';
    }).join('');
  }

  // --- Ledger Event Listeners ---
  document.getElementById('ledger-search').addEventListener('input', renderLedger);
  document.getElementById('ledger-sort').addEventListener('change', renderLedger);
  document.getElementById('export-ledger-btn').addEventListener('click', () => {
    const headers = ['TXID', 'Timestamp', 'Customer', 'Amount', 'Method', 'Fee Saved', 'Status'];
    const rows = cacheLedger.map(item => [
      item.txid,
      item.timestamp,
      item.customer,
      item.amount,
      item.method,
      item.feeSaved,
      item.status
    ]);
    let csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "transaction_ledger.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('CSV Export started.');
  });

  /* ---- init ---- */
  function init() {
    // Apply initial theme
    applyTheme(getTheme());

    // Check if token exists in session
    if (getToken()) {
      currentUserRole = sessionStorage.getItem('omni_dash_role') || 'Employee';
      showDash();
      loadOverview();
      startRefresh();
      resetInactivityTimer();
    } else {
      showUnlock();
    }
  }

  init();

}());
