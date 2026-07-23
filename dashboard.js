/* OmniTender CRM Dashboard JS — Unified console logic
 * API: https://omnitender-omniverse.fly.dev (or relative for same-origin backend)
 * Token: sessionStorage only
 */

(function () {
  'use strict';

  // Autodetect if we are running on the Fly backend directly or on the static site
  var API = window.location.hostname === 'omnitender-omniverse.fly.dev' || window.location.port === '3000'
    ? ''
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '[::1]'
      ? 'http://' + window.location.hostname + ':3000'
      : 'https://omnitender-omniverse.fly.dev');

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
    sessionStorage.removeItem('omni_dash_pending_setup');
  }

  function markPendingSetup(on) {
    if (on) sessionStorage.setItem('omni_dash_pending_setup', '1');
    else sessionStorage.removeItem('omni_dash_pending_setup');
  }

  /* ---- Demo / offline login (no backend required) ----
   * These accounts sign in entirely in the browser so the CRM console can be
   * demoed and tested while the live backend has no /api/login route. Username
   * is matched case-insensitively; the PIN must match exactly. Live data panels
   * (leads, pipeline, stats) stay empty in demo mode — there is no backend to
   * read from. To remove a demo account, delete its line from DEMO_USERS.
   */
  var DEMO_USERS = {
    simontest:  { username: 'SimonTest',  pin: '123456', role: 'Employee' },
    aduratest:  { username: 'Aduratest',  pin: '123456', role: 'Employee' },
    sylviatest: { username: 'Sylviatest', pin: '123456', role: 'Employee' },
    bilaltest:  { username: 'Bilaltest',  pin: '123456', role: 'Employee' }
  };
  var DEMO_TOKEN = 'demo-session';
  function isDemoSession() { return getToken() === DEMO_TOKEN; }
  function matchDemoUser(user, pass) {
    var rec = DEMO_USERS[String(user || '').trim().toLowerCase()];
    return (rec && String(pass) === rec.pin) ? rec : null;
  }
  function startDemoSession(rec) {
    setToken(DEMO_TOKEN);
    sessionStorage.setItem('omni_dash_role', rec.role);
    sessionStorage.setItem('omni_dash_username', rec.username);
    currentUserRole = rec.role;
    markPendingSetup(false);
  }
  function renderDemoOverview() {
    var set = function (id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; };
    set('health', '<span class=down>● DEMO MODE</span> — live backend not connected');
    set('stats', [['—', 'Leads'], ['—', 'Onboarding'], ['—', 'Tickets'], ['—', 'Calls']]
      .map(function (p) { return '<div class=stat><div class=n>' + p[0] + '</div><div class=l>' + p[1] + '</div></div>'; }).join(''));
    var q = document.getElementById('queue');
    if (q) q.textContent = 'Demo mode — no live queue data.';
    set('followup-queue', '<div class="empty">Demo mode — no live data.</div>');
    set('pipeline-chart', '<div class="empty">Demo mode — connect the backend to see live pipeline data.</div>');
    var banner = document.getElementById('alertbar');
    if (banner) {
      banner.style.display = 'block';
      banner.textContent = '🧪 Demo mode — signed in without the live backend. Lead, pipeline and stats data are not loaded.';
    }
  }

  function applySetupQr(res) {
    const secret = res.secret || '';
    document.getElementById('mfa-secret-text').textContent = secret || '—';
    const copyBtn = document.getElementById('mfa-secret-copy');
    if (copyBtn) copyBtn.disabled = !secret;
    const qrImg = document.getElementById('mfa-qr-image');
    const qrPlaceholder = document.getElementById('mfa-qr-placeholder');
    if (res.mfaQr && res.mfaQr.startsWith('data:image/')) {
      qrPlaceholder.style.display = 'none';
      qrImg.onload = function() { qrImg.style.display = 'block'; };
      qrImg.onerror = function() {
        qrImg.style.display = 'none';
        qrPlaceholder.style.display = 'flex';
        qrPlaceholder.textContent = 'QR failed — enter key manually below';
      };
      qrImg.src = res.mfaQr;
    } else {
      qrImg.style.display = 'none';
      qrPlaceholder.style.display = 'flex';
      qrPlaceholder.textContent = 'Enter key manually below';
    }
  }

  async function resumeSetupWizard(username) {
    document.getElementById('unlock-view').style.display = 'none';
    document.getElementById('dash-view').style.display = 'none';
    showSetupModal(username);
    try {
      const res = await api('/api/console_users/mfa-setup');
      applySetupQr(res);
      document.getElementById('mfa-setup-step1').style.display = 'none';
      document.getElementById('mfa-setup-step2').style.display = 'block';
      toast('Welcome back — finish scanning the QR and enter your verification code.');
    } catch (_) {
      toast('First login — choose your permanent username and PIN.');
    }
  }

  /* ---- view switching ---- */
  function showUnlock(errMsg) {
    document.getElementById('mfa-setup-modal').style.display = 'none';
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
    loadSystemsPortals();
    resetInactivityTimer();
    openTabFromHash();
  }

  function openTab(tab) {
    var btn = document.querySelector('nav button[data-v="' + tab + '"]');
    if (!btn) return;
    btn.click();
    try {
      if (tab && tab !== 'overview') history.replaceState(null, '', '#/' + tab);
      else history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (_) { /* ignore */ }
  }

  function openTabFromHash() {
    var raw = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase();
    if (raw && loaders[raw]) openTab(raw);
  }

  async function loadSystemsPortals() {
    var wrap = document.getElementById('systems-portals-wrap');
    var nav = document.getElementById('systems-portals-nav');
    if (!wrap || !nav) return;
    if (currentUserRole !== 'Admin') {
      wrap.style.display = 'none';
      nav.innerHTML = '';
      return;
    }
    wrap.style.display = 'block';
    try {
      var r = await fetch('systems-portal.json?v=1');
      if (!r.ok) throw new Error('load failed');
      var data = await r.json();
      nav.innerHTML = (data.portals || []).map(function (p) {
        return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" class="nav-portal-link" title="' + esc(p.description || '') + '">' +
          esc(p.icon || '•') + ' ' + esc(p.label) + '</a>';
      }).join('');
    } catch (_) {
      nav.innerHTML = '<a href="https://omnitender-omniverse.fly.dev/admin" target="_blank" rel="noopener" class="nav-portal-link">⚙️ OmniVerse Admin</a>';
    }
  }

  /* ---- fetch helpers ---- */
  function authHeaders() {
    return { 'Authorization': 'Bearer ' + getToken() };
  }

  async function api(path, opts) {
    // Demo / offline accounts never call the live backend. Without this guard the
    // demo token is sent to the server, rejected with 401, and the user is logged
    // out with "Session expired". Throw a benign error instead (callers handle it).
    if (isDemoSession()) {
      throw new Error('Demo mode — live data is not connected.');
    }
    const o = opts || {};
    const init = { method: o.method || 'GET', headers: authHeaders() };
    if (init.method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-OV-Console'] = '1';
      init.body = JSON.stringify(o.body || {});
    }
    let r;
    try {
      r = await fetch(API + path, init);
    } catch (networkErr) {
      throw new Error('Could not reach the OmniVerse backend (' + (API || 'same origin') + '). Check your connection or wait a moment if a deploy is in progress.');
    }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (r.status === 401) {
      clearToken();
      document.getElementById('mfa-setup-modal').style.display = 'none';
      const msg = (data && data.error) ? data.error : 'Session expired. Please log in again.';
      showUnlock(msg);
      throw new Error(msg);
    }
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

  async function copyMfaSecret() {
    const secret = document.getElementById('mfa-secret-text').textContent.trim();
    if (!secret || secret === '—') {
      toast('Setup key not ready yet.', true);
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(secret);
      } else {
        const ta = document.createElement('textarea');
        ta.value = secret;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast('Setup key copied — paste it into your authenticator app.');
    } catch (_) {
      toast('Could not copy — select the key and copy manually.', true);
    }
  }

  function updateNavBadge(tab, count) {
    var btn = document.querySelector('nav button[data-v="' + tab + '"]');
    if (!btn) return;
    var existing = btn.querySelector('.nav-badge');
    if (!count || count <= 0) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      existing = document.createElement('span');
      existing.className = 'nav-badge';
      btn.appendChild(existing);
    }
    existing.textContent = count > 99 ? '99+' : String(count);
  }

  async function refreshNavBadges() {
    try {
      var b = await api('/api/dashboard/badges');
      updateNavBadge('feedback', b.feedback || 0);
      updateNavBadge('leads', b.leads || 0);
      updateNavBadge('pipeline', b.pipeline || 0);
    } catch (_) { /* non-fatal */ }
  }

  function assigneeHtml(record) {
    if (!record || !record.assignedTo) return '';
    return '<p style="font-size:11px;color:var(--muted);margin:6px 0 0;">👤 Assigned to <strong>' + esc(record.assignedTo) + '</strong></p>';
  }

  /* ---- tabs ---- */
  const loaders = {
    overview: loadOverview,
    ledger: loadLedger,
    pipeline: loadPipeline,
    mail: loadMail,
    training: loadTraining,
    leads: loadLeads,
    feedback: loadFeedback,
    access: loadAccess,
    savings: loadPricing,
    digest: loadDigest,
    social: loadSocial
  };

  document.getElementById('nav').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + b.dataset.v));
    if (loaders[b.dataset.v]) loaders[b.dataset.v]();
    try {
      var tab = b.dataset.v;
      if (tab && tab !== 'overview') history.replaceState(null, '', '#/' + tab);
      else history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (_) { /* ignore */ }
  });

  window.addEventListener('hashchange', function () {
    if (document.getElementById('dash-view')?.style.display === 'block') openTabFromHash();
  });

  function loadMail() {
    if (window.OmniTenderMail) window.OmniTenderMail.init();
  }

  function loadTraining() {
    if (window.OmniTenderEducation) window.OmniTenderEducation.init();
  }

  async function loadTrainingOverview() {
    var el = document.getElementById('training-overview');
    if (!el) return;
    if (isDemoSession()) {
      el.innerHTML = '<span style="color:var(--faint);">Demo mode — sign in with a live account to track lesson progress.</span>';
      return;
    }
    try {
      var cat = await api('/api/education/catalog');
      var prog = await api('/api/education/progress');
      var lessons = cat.lessons || [];
      var core = lessons.filter(function (l) { return (l.tags || []).indexOf('required') >= 0 || l.sectionTitle === 'Core onboarding'; });
      if (!core.length) core = lessons.slice(0, 6);
      var completed = (prog.progress && prog.progress.completed) || {};
      var done = core.filter(function (l) { return completed[l.id]; }).length;
      var total = core.length;
      var next = core.find(function (l) { return !completed[l.id]; });
      var html = '<strong>' + done + ' of ' + total + '</strong> required lessons complete.';
      if (next) {
        html += ' Next up: <em>' + esc(next.title) + '</em>.';
      } else if (total > 0) {
        html += ' <span style="color:var(--accent);">All required lessons done.</span>';
      }
      el.innerHTML = html;
      updateNavBadge('training', total - done);
    } catch (_) {
      el.innerHTML = 'Open <strong>Training</strong> in the sidebar to read lesson scripts and mark progress.';
    }
  }

  document.getElementById('training-open-btn')?.addEventListener('click', function () {
    openTab('training');
  });

  /* ---- Overview ---- */
  async function loadOverview() {
    if (isDemoSession()) { renderDemoOverview(); return; }
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
    loadFollowUpQueue();
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
    refreshNavBadges();
    loadTrainingOverview();
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

  async function loadFollowUpQueue() {
    var el = document.getElementById('followup-queue');
    if (!el) return;
    try {
      var lj = await api('/leads');
      var pj = await api('/api/pipeline');
      var leads = (lj.leads || []).filter(function (l) {
        var q = l.qualification || {};
        if (q.status === 'ready_for_human') return true;
        var s = l.status || 'open';
        return s !== 'archived' && s !== 'contacted';
      }).sort(function (a, b) {
        var qa = (a.qualification || {}).status === 'ready_for_human' ? 1 : 0;
        var qb = (b.qualification || {}).status === 'ready_for_human' ? 1 : 0;
        if (qa !== qb) return qb - qa;
        var ia = (a.qualification || {}).interest === 'hot' ? 2 : (a.qualification || {}).interest === 'warm' ? 1 : 0;
        var ib = (b.qualification || {}).interest === 'hot' ? 2 : (b.qualification || {}).interest === 'warm' ? 1 : 0;
        return ib - ia;
      }).slice(0, 6);
      var pipe = (pj.items || []).filter(function (o) {
        var q = o.qualification || {};
        if (q.status === 'ready_for_human') return true;
        return o.stage === 'applied' || (o.stage === 'in_review' && !o.contactedAt);
      }).sort(function (a, b) {
        var qa = (a.qualification || {}).status === 'ready_for_human' ? 1 : 0;
        var qb = (b.qualification || {}).status === 'ready_for_human' ? 1 : 0;
        return qb - qa;
      }).slice(0, 6);
      if (!leads.length && !pipe.length) {
        el.innerHTML = '<div class="empty">No one waiting for outreach — new website forms will appear here automatically.</div>';
        return;
      }
      var rows = [];
      leads.forEach(function (l) {
        var q = l.qualification || {};
        var qualNote = q.summary ? '<br><span style="font-size:11px;color:var(--muted);">' + esc(q.summary) + '</span>' : '';
        var assignNote = l.assignedTo ? '<br><span style="font-size:11px;color:var(--faint);">👤 ' + esc(l.assignedTo) + '</span>' : '';
        rows.push('<div class="item" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<div><strong>' + esc(l.name || 'Lead') + '</strong> <span class="badge b-in_review">SMS lead</span>' + qualificationBadge(q) + '<br>' +
          '<span style="font-size:12px;color:var(--muted);">' + esc(l.phone || 'no phone') + '</span>' + qualNote + assignNote + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + renderContactButtons(l.phone) +
          '<button type="button" class="btn" onclick="document.querySelector(\'nav button[data-v=leads]\').click()" style="width:auto;min-height:32px;padding:0 10px;margin:0;font-size:11px;">Open Leads</button></div></div>');
      });
      pipe.forEach(function (o) {
        var q = o.qualification || {};
        var qualNote = q.summary ? '<br><span style="font-size:11px;color:var(--muted);">' + esc(q.summary) + '</span>' : '';
        rows.push('<div class="item" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<div><strong>' + esc(o.name) + '</strong> <span class="badge b-applied">Application</span>' + qualificationBadge(q) + '<br>' +
          '<span style="font-size:12px;color:var(--muted);">' + esc(o.phone || 'no phone') + (o.business ? ' · ' + esc(o.business) : '') + '</span>' + qualNote + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + renderContactButtons(o.phone) +
          '<button type="button" class="btn" onclick="document.querySelector(\'nav button[data-v=pipeline]\').click()" style="width:auto;min-height:32px;padding:0 10px;margin:0;font-size:11px;">Open Pipeline</button></div></div>');
      });
      el.innerHTML = rows.join('');
    } catch (e) {
      el.innerHTML = '<div class="empty">Could not load follow-up queue.</div>';
    }
  }

  /* ---- Pipeline ---- */
  function qualificationBadge(q) {
    if (!q || !q.status || q.status === 'none') return '';
    var labels = {
      awaiting_reply: ['AI outreach sent', '#a78bfa'],
      in_progress: ['AI chatting', '#818cf8'],
      ready_for_human: ['Ready for human', '#34d399'],
      not_interested: ['Not interested', '#a1a1a1'],
    };
    var interest = q.interest === 'hot' ? ' 🔥' : q.interest === 'warm' ? ' 🟡' : '';
    var row = labels[q.status];
    if (!row) return '';
    return ' <span class="badge" style="background:' + row[1] + '22;color:' + row[1] + ';">' + esc(row[0]) + interest + '</span>';
  }

  function qualificationSummaryHtml(q) {
    if (!q || q.status === 'none') return '';
    var html = '<div style="margin:8px 0;padding:10px 12px;border-radius:8px;background:rgba(129,140,248,0.08);border:1px solid rgba(129,140,248,0.2);">';
    html += '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;">AI qualification</p>';
    if (q.summary) html += '<p style="margin:0 0 6px;font-size:12px;"><strong>Summary:</strong> ' + esc(q.summary) + '</p>';
    if (q.interest) html += '<p style="margin:0;font-size:12px;"><strong>Interest:</strong> ' + esc(q.interest) + (q.score != null ? ' (' + esc(String(q.score)) + ')' : '') + '</p>';
    if (q.status === 'ready_for_human') {
      html += '<p style="margin:8px 0 0;font-size:11px;color:var(--up);font-weight:600;">Human follow-up — call or text and answer their questions.</p>';
    }
    return html + '</div>';
  }

  function renderContactButtons(phone, marginLeft) {
    var tel = leadPhoneHref(phone);
    var ml = marginLeft || '0';
    if (!tel) {
      return '<span style="font-size:11px;color:var(--faint);">No phone — use notes or email in source</span>';
    }
    return '<a class="btn btn-go" href="tel:' + esc(tel) + '" style="width:auto;min-height:34px;padding:0 14px;margin:0;text-decoration:none;">📞 Call</a>' +
      '<a class="btn btn-secondary" href="sms:' + esc(tel) + '" style="width:auto;min-height:34px;padding:0 14px;margin:0 0 0 8px;text-decoration:none;">💬 Text</a>';
  }

  const NEXT_LABEL = { applied: 'Approve merchant', in_review: 'Approve merchant', approved: 'Advance → hardware', hardware_sent: 'Advance → active' };

  function crossBorderLabel(v) {
    var map = {
      '0': '0% (local / U.S. only)',
      '1-25': '1–25%',
      '26-50': '26–50%',
      '51-75': '51–75%',
      '76-100': '76–100%',
      unsure: 'Not sure yet',
    };
    return map[v] || v || '';
  }

  function paymentProfileHtml(o) {
    var parts = [];
    if (o.settlementCurrency) parts.push('<strong>Settlement:</strong> ' + esc(o.settlementCurrency));
    if (o.customerCurrencies) parts.push('<strong>Customer currencies:</strong> ' + esc(o.customerCurrencies));
    if (o.crossBorderPct) parts.push('<strong>Cross-border:</strong> ' + esc(crossBorderLabel(o.crossBorderPct)));
    if (o.internationalCheckout) parts.push('<strong>Intl checkout:</strong> Yes');
    if (o.notes) parts.push('<strong>Volume:</strong> ' + esc(o.notes));
    if (!parts.length) {
      return '<p style="font-size:11px;color:var(--faint);margin:8px 0 0;">No payment profile captured yet.</p>';
    }
    return '<div style="margin:10px 0 0;padding:10px 12px;border:1px solid var(--card-edge);border-radius:8px;font-size:12px;line-height:1.55;">' +
      '<span style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;">Payment profile</span>' +
      '<div style="margin-top:6px;">' + parts.join(' · ') + '</div></div>';
  }

  function pipeItem(o, closed) {
    const itemId = 'pi-' + esc(o.shortId);
    let detail = [o.business, o.phone, o.source ? 'via ' + o.source : ''].filter(Boolean).join(' · ');
    const contactedNote = o.contactedAt
      ? '<p style="font-size:11px;color:var(--up);margin:8px 0 0;">Contacted ' + esc(new Date(o.contactedAt).toLocaleString()) +
        (o.contactedBy ? ' by ' + esc(o.contactedBy) : '') + '</p>'
      : (o.qualification && o.qualification.status === 'ready_for_human')
        ? '<p style="font-size:11px;color:var(--up);margin:8px 0 0;font-weight:600;">AI qualified — human should call or text next.</p>'
        : (o.qualification && (o.qualification.status === 'awaiting_reply' || o.qualification.status === 'in_progress'))
          ? '<p style="font-size:11px;color:var(--accent);margin:8px 0 0;">AI assistant is chatting with them now…</p>'
          : '<p style="font-size:11px;color:var(--accent);margin:8px 0 0;font-weight:600;">Needs outreach — any employee can call or text now.</p>';
    let html = '<div class="disc-item" id="' + itemId + '">' +
      '<div class="disc-summary">' +
      '<span class="chev">▶</span>' +
      '<span class="t">' + esc(o.name) +
        '<span class="badge b-' + esc(o.stage) + '">' + esc(o.stage.replace('_', ' ')) + '</span>' +
        qualificationBadge(o.qualification) +
      '</span>' +
      '<span class="m">' + esc(o.shortId) + (o.phone ? ' · ' + esc(o.phone) : '') + '</span>' +
      '</div>' +
      '<div class="disc-body">';
    html += '<div class="m" style="margin-bottom:8px">' +
      '<strong>Phone:</strong> ' + esc(o.phone || 'N/A') +
      (o.business ? ' · <strong>Business:</strong> ' + esc(o.business) : '') +
      (o.source ? ' · via ' + esc(o.source) : '') +
      '</div>' + paymentProfileHtml(o) + contactedNote + assigneeHtml(o) + qualificationSummaryHtml(o.qualification);
      
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

    html += '<div class="actions" style="margin-top:12px; flex-wrap:wrap; gap:8px; align-items:center;">';
    html += renderContactButtons(o.phone);
    if (!closed && (o.stage === 'applied' || o.stage === 'in_review') && !o.assignedTo) {
      html += '<button type="button" class="btn" data-act="claim" data-id="' + esc(o.shortId) + '" data-name="' + esc(o.name) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">👤 Claim</button>';
    }
    if (!closed && (o.stage === 'applied' || o.stage === 'in_review')) {
      if (!o.contactedAt) {
        html += '<button type="button" class="btn" data-act="contact" data-id="' + esc(o.shortId) + '" data-name="' + esc(o.name) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">✓ Mark contacted</button>';
      }
      html += '<button type="button" class="btn btn-go" data-act="approve" data-id="' + esc(o.shortId) + '" data-name="' + esc(o.name) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">' + (NEXT_LABEL[o.stage] || 'Approve merchant') + '</button>' +
        '<button type="button" class="btn btn-no" data-act="reject" data-id="' + esc(o.shortId) + '" data-name="' + esc(o.name) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0;">Not interested</button>';
    } else if (!closed) {
      html += '<button type="button" class="btn btn-go" data-act="advance" data-id="' + esc(o.shortId) + '" data-name="' + esc(o.name) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">' + (NEXT_LABEL[o.stage] || 'Advance') + '</button>';
    }
    html += '<button type="button" class="btn btn-secondary btn-modal" data-modal-type="pipeline" data-modal-id="' + esc(o.shortId) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0;">🔍 Details</button></div>';
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
      refreshNavBadges();
    } catch (e) { document.getElementById('pipe').innerHTML = '<div class=empty>Failed to load: ' + esc(e.message) + '</div>'; }
  }

  /* ---- Leads ---- */
  var LEAD_ARCHIVED = 'archived';

  function leadStatus(l) {
    return l.status || 'open';
  }

  function leadIsArchived(l) {
    return leadStatus(l) === LEAD_ARCHIVED;
  }

  function leadLooksLikeTest(l) {
    var blob = [l.name, l.phone, l.business, l.notes, l.source].join(' ').toLowerCase();
    return /test|smoke|demo|example|fake|dummy|pipeline smoke/.test(blob);
  }

  function leadPhoneHref(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) digits = '1' + digits;
    return '+' + digits;
  }

  function formatLeadWhen(l) {
    var raw = l.at || l.createdAt;
    if (!raw) return 'N/A';
    try { return new Date(raw).toLocaleString(); } catch (e) { return raw; }
  }

  function filterLeadsByQueue(list) {
    var filterEl = document.getElementById('leads-filter');
    var filter = filterEl ? filterEl.value : 'active';
    if (filter === 'active') {
      return list.filter(function (l) { return !leadIsArchived(l); });
    }
    if (filter === 'archived') {
      return list.filter(function (l) { return leadIsArchived(l); });
    }
    if (!filter) return list.slice();
    return list.filter(function (l) { return leadStatus(l) === filter; });
  }

  function renderLeadsSummary(shown, total) {
    var el = document.getElementById('leads-queue-summary');
    if (!el) return;
    var open = 0;
    var contacted = 0;
    var archived = 0;
    cacheLeads.forEach(function (l) {
      var s = leadStatus(l);
      if (s === 'archived') archived++;
      else if (s === 'contacted') contacted++;
      else open++;
    });
    el.textContent = shown + ' shown · ' + open + ' open · ' + contacted + ' contacted · ' + archived + ' archived (' + total + ' total)';
  }

  function renderLeadItem(l) {
    var status = leadStatus(l);
    var statusColors = { open: '#F7792C', contacted: '#60a5fa', archived: '#a1a1a1' };
    var badge = '<span style="display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.06);color:' + (statusColors[status] || statusColors.open) + ';">' + esc(status) + '</span>';
    var testBadge = leadLooksLikeTest(l) ? ' <span class="badge b-in_review">likely test</span>' : '';
    var qualBadge = qualificationBadge(l.qualification);
    var phone = l.phone || '';
    var tel = leadPhoneHref(phone);
    var contactBtns = tel
      ? '<a class="btn btn-go" href="tel:' + esc(tel) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0;text-decoration:none;">📞 Call</a>' +
        '<a class="btn btn-secondary" href="sms:' + esc(tel) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;text-decoration:none;">💬 Text</a>'
      : '<span style="font-size:11px;color:var(--faint);">No phone on file</span>';
    var noteBlock = l.followUpNote
      ? '<p><strong>Follow-up note:</strong> ' + esc(l.followUpNote) + '</p>'
      : '';
    var promoted = l.promotedToPipelineId
      ? '<p style="font-size:11px;color:var(--up);">Moved to Pipeline — check the Pipeline tab.</p>'
      : '';

    return '<div class="disc-item' + (leadIsArchived(l) ? ' fb-archived' : '') + '" id="lead-' + esc(l.id) + '">' +
      '<div class="disc-summary"><span class="chev">▶</span><span class="t">' + esc(l.name || '(no name)') + testBadge + qualBadge + '</span>' +
      '<span class="m">' + esc(phone) + ' · ' + badge + '</span></div>' +
      '<div class="disc-body">' +
        '<p><strong>Phone:</strong> ' + (phone ? esc(phone) : 'N/A') + '</p>' +
        '<p><strong>Business:</strong> ' + esc(l.business || 'N/A') + '</p>' +
        '<p><strong>Consent (SMS):</strong> ' + (l.consent ? 'Yes' : 'No / unknown') + '</p>' +
        '<p><strong>Source:</strong> ' + esc(l.source || 'website') + '</p>' +
        '<p><strong>Notes:</strong> ' + esc(l.notes || 'N/A') + '</p>' +
        qualificationSummaryHtml(l.qualification) +
        assigneeHtml(l) +
        noteBlock + promoted +
        '<p><strong>Submitted:</strong> ' + esc(formatLeadWhen(l)) + '</p>' +
        '<div class="actions" style="flex-wrap:wrap; gap:8px; align-items:center;">' + contactBtns +
          (!leadIsArchived(l) && !l.assignedTo ? '<button type="button" class="btn" data-lead-claim="' + esc(l.id) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">👤 Claim</button>' : '') +
          (status !== 'contacted' && !leadIsArchived(l) ? '<button type="button" class="btn" data-lead-action="' + esc(l.id) + '" data-lead-status="contacted" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">✓ Mark contacted</button>' : '') +
          (!leadIsArchived(l) ? '<button type="button" class="btn" data-lead-promote="' + esc(l.id) + '" data-lead-name="' + esc(l.name || '') + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">→ Pipeline</button>' : '') +
          (!leadIsArchived(l) ? '<button type="button" class="btn" data-lead-action="' + esc(l.id) + '" data-lead-status="archived" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">Archive</button>' : '') +
          (leadIsArchived(l) ? '<button type="button" class="btn" data-lead-action="' + esc(l.id) + '" data-lead-status="open" style="width:auto;min-height:34px;padding:0 12px;margin:0;">Reopen</button>' : '') +
          (currentUserRole === 'Admin' && (leadIsArchived(l) || l.erasure) ? '<button type="button" class="btn btn-no" data-lead-delete="' + esc(l.id) + '" data-lead-name="' + esc(l.name || 'lead') + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">Delete permanently</button>' : '') +
          '<button type="button" class="btn btn-no" data-erase="' + esc(l.id) + '" data-name="' + esc(l.name || '') + '" style="width:auto;min-height:34px;padding:0 12px;margin:0 0 0 8px;">Erase PII</button>' +
          '<button type="button" class="btn btn-secondary btn-modal" data-modal-type="lead" data-modal-id="' + esc(l.id) + '" style="width:auto;min-height:34px;padding:0 12px;margin:0;">🔍 Details</button>' +
        '</div></div></div>';
  }

  function renderLeadsList() {
    const searchVal = document.getElementById('leads-search').value.toLowerCase().trim();

    const searched = cacheLeads.filter(function (l) {
      return !searchVal ||
             (l.name && l.name.toLowerCase().includes(searchVal)) ||
             (l.phone && l.phone.toLowerCase().includes(searchVal)) ||
             (l.business && l.business.toLowerCase().includes(searchVal)) ||
             (l.source && l.source.toLowerCase().includes(searchVal)) ||
             (l.notes && l.notes.toLowerCase().includes(searchVal));
    });

    const filtered = filterLeadsByQueue(searched);
    const el = document.getElementById('leadlist');
    renderLeadsSummary(filtered.length, cacheLeads.length);

    if (!cacheLeads.length) {
      el.innerHTML = '<div class="empty">No leads yet — they appear here when someone submits the SMS opt-in form on the homepage.</div>';
      return;
    }
    if (!filtered.length) {
      el.innerHTML = '<div class="empty">No leads match this filter.</div>';
      return;
    }
    el.innerHTML = filtered.map(renderLeadItem).join('');
  }

  async function loadLeads() {
    try {
      var filterEl = document.getElementById('leads-filter');
      if (filterEl && !filterEl.dataset.inited) {
        var saved = sessionStorage.getItem('omni_leads_filter');
        if (saved !== null && filterEl.querySelector('option[value="' + saved + '"]')) {
          filterEl.value = saved;
        }
        filterEl.dataset.inited = '1';
      }
      const lj = await api('/leads');
      cacheLeads = lj.leads || [];
      renderLeadsList();
      refreshNavBadges();
    } catch (e) { document.getElementById('leadlist').innerHTML = '<div class=empty>Failed to load: ' + esc(e.message) + '</div>'; }
  }

  /* ---- Feedback (three-card triage) ---- */
  var cacheFeedback = [];
  var feedbackPick = {};
  var FEEDBACK_ARCHIVED = ['done', 'declined'];

  function feedbackIsArchived(f) {
    return FEEDBACK_ARCHIVED.indexOf(f.status || 'new') >= 0;
  }

  function feedbackCounts() {
    var active = 0;
    var archived = 0;
    cacheFeedback.forEach(function (f) {
      if (feedbackIsArchived(f)) archived++;
      else active++;
    });
    return { active: active, archived: archived };
  }

  function filterFeedbackItems() {
    var filterEl = document.getElementById('feedback-filter');
    var filter = filterEl ? filterEl.value : 'active';
    if (filter === 'active') {
      return cacheFeedback.filter(function (f) { return !feedbackIsArchived(f); });
    }
    if (filter === 'archived') {
      return cacheFeedback.filter(function (f) { return feedbackIsArchived(f); });
    }
    if (!filter) return cacheFeedback.slice();
    return cacheFeedback.filter(function (f) { return (f.status || 'new') === filter; });
  }

  function renderFeedbackSummary() {
    var el = document.getElementById('feedback-queue-summary');
    if (!el) return;
    var c = feedbackCounts();
    var filter = (document.getElementById('feedback-filter') || {}).value || 'active';
    var hint = filter === 'active'
      ? (c.active ? c.active + ' need attention · ' + c.archived + ' archived' : 'Queue clear · ' + c.archived + ' archived')
      : c.active + ' active · ' + c.archived + ' archived';
    el.textContent = hint;
  }

  function feedbackRecommendedSlot(f) {
    return typeof f.recommendedSlot === 'number' ? f.recommendedSlot : 0;
  }

  function defaultFeedbackPick(f) {
    const rec = feedbackRecommendedSlot(f);
    const proposals = f.proposals || ['', '', ''];
    let slot = rec;
    if (!proposals[slot]) {
      slot = proposals.findIndex(function (p) { return !!p; });
      if (slot < 0) slot = rec;
    }
    const text = (proposals[slot] || '').trim();
    return {
      text: text,
      slot: text ? slot : null,
      source: slot === rec ? 'recommended' : 'card'
    };
  }

  function resolveFeedbackPick(f) {
    return feedbackPick[f.id] || defaultFeedbackPick(f);
  }

  function feedbackPickLabel(pick, f) {
    if (pick.source === 'custom' || pick.slot === null || pick.slot === undefined) return 'Custom fix';
    if (pick.slot === feedbackRecommendedSlot(f)) return 'Option ' + (pick.slot + 1) + ' · Recommended';
    return 'Option ' + (pick.slot + 1);
  }

  function cardApproveFixLabel(slot, f) {
    if (slot === feedbackRecommendedSlot(f)) return '✓ Approve recommended fix';
    return '✓ Approve option ' + (slot + 1);
  }

  function renderAcceptPreview(f, pick) {
    const preview = pick.text
      ? esc(pick.text)
      : '<span style="color:var(--faint); font-style:italic;">Pick a card or write a custom fix below</span>';
    return '<div class="fb-accept-preview" id="fb-accept-preview-' + esc(f.id) + '">' +
      '<div class="label">Fix you will accept (one only — not all three)</div>' +
      '<div class="text">' + preview + '</div>' +
      '<div class="meta">' + esc(feedbackPickLabel(pick, f)) + '</div>' +
    '</div>';
  }

  function resolveAcceptedSlot(f, solution, pick) {
    if (pick && pick.source === 'custom') return null;
    if (pick && pick.slot !== null && pick.slot !== undefined && pick.text === solution) return pick.slot;
    const proposals = f.proposals || [];
    for (let i = 0; i < 3; i++) {
      if (proposals[i] && proposals[i].trim() === solution) return i;
    }
    return null;
  }

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

  function feedbackCategoryLabel(cat) {
    if (cat === 'improvement') return '✨ Improvement';
    if (cat === 'question') return '❓ Question';
    return '🐞 Bug';
  }

  function renderProposalCard(f, slot) {
    const proposals = f.proposals || ['', '', ''];
    const text = proposals[slot] || '';
    const pick = resolveFeedbackPick(f);
    const selected = pick.slot === slot && !!text && pick.text === text;
    const rec = feedbackRecommendedSlot(f);
    const isRec = slot === rec && !!text;
    const label = 'Option ' + (slot + 1);
    const badge = isRec ? '<span class="fb-proposal-badge">★ Recommended</span>' : '';
    if (!text) {
      return '<div class="fb-proposal-card empty" data-fb-id="' + esc(f.id) + '" data-fb-slot="' + slot + '">' +
        '<div class="fb-proposal-head"><span class="fb-proposal-label">' + label + '</span>' + badge + '</div>' +
        '<div class="fb-proposal-text" style="color:var(--faint); font-style:italic;">Dismissed — reroll to draw a new card</div>' +
        '<div class="fb-proposal-actions">' +
          '<button type="button" class="btn" data-fb-reroll="' + esc(f.id) + '" data-fb-slot="' + slot + '">↻ Reroll</button>' +
        '</div></div>';
    }
    const cardClass = 'fb-proposal-card' + (selected ? ' on' : '') + (isRec ? ' recommended' : '');
    return '<div class="' + cardClass + '" data-fb-pick="' + esc(f.id) + '" data-fb-slot="' + slot + '">' +
      '<div class="fb-proposal-head"><span class="fb-proposal-label">' + label + '</span>' + badge + '</div>' +
      '<div class="fb-proposal-text">' + esc(text) + '</div>' +
      '<div class="fb-proposal-actions">' +
        '<button type="button" class="btn btn-go fb-card-approve" data-fb-accept-card="' + esc(f.id) + '" data-fb-slot="' + slot + '">' + esc(cardApproveFixLabel(slot, f)) + '</button>' +
        '<button type="button" class="btn" data-fb-reroll="' + esc(f.id) + '" data-fb-slot="' + slot + '">↻ Reroll</button>' +
        '<button type="button" class="btn btn-no" data-fb-dismiss="' + esc(f.id) + '" data-fb-slot="' + slot + '">✕ Dismiss</button>' +
        '<button type="button" class="btn" data-fb-edit="' + esc(f.id) + '" data-fb-slot="' + slot + '">✎ Edit</button>' +
      '</div></div>';
  }

  function renderFeedbackItem(f) {
    const catLabel = feedbackCategoryLabel(f.category || 'bug');
    const when = f.at ? new Date(f.at).toLocaleString() : '';
    const msg = (f.message || '').trim();
    const msgBlock = msg
      ? '<div class="fb-message">' + esc(msg) + '</div>'
      : '<div class="fb-message" style="color:var(--faint); font-style:italic;">(No message text — check screenshot/context below)</div>';
    const ctx = f.context
      ? '<div style="font-size:11px; color:var(--faint); word-break:break-all;">Page: ' + esc(f.context) + '</div>'
      : '';
    const shot = f.screenshot
      ? '<details style="margin-top:8px;"><summary style="cursor:pointer; font-size:11px; color:var(--accent);">View screenshot</summary><img src="' + esc(f.screenshot) + '" alt="Feedback screenshot" style="max-width:100%; margin-top:8px; border-radius:8px; border:1px solid var(--card-edge);"></details>'
      : '';
    const chosen = f.chosenSolution
      ? '<div style="margin-top:10px; padding:10px; border-left:3px solid var(--up); background:rgba(52,211,153,0.08); font-size:12px;"><strong>Accepted fix' +
        (f.acceptedRecommended ? ' (recommended)' : (typeof f.acceptedSlot === 'number' ? ' (option ' + (f.acceptedSlot + 1) + ')' : '')) +
        ':</strong> ' + esc(f.chosenSolution) + '</div>'
      : '';
    const noteVal = esc(f.reviewNote || '');
    const pick = resolveFeedbackPick(f);
    const customVal = esc(pick.text || f.chosenSolution || '');
    const closed = f.status === 'done' || f.status === 'declined';

    if (closed) {
      return '<div class="fb-item fb-archived">' +
        '<div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">' +
          '<div><strong>' + catLabel + '</strong> ' + feedbackStatusBadge(f.status) + '</div>' +
          '<span style="font-size:11px; color:var(--faint);">' + esc(when) + '</span>' +
        '</div>' + msgBlock + ctx + chosen +
        (f.reviewNote ? '<div style="font-size:11px; color:var(--muted); margin-top:8px;">Note: ' + noteVal + '</div>' : '') +
        '<div class="fb-toolbar">' +
          '<button type="button" class="btn" data-fb-status="' + esc(f.id) + '" data-status="reviewing">Reopen</button>' +
          (currentUserRole === 'Admin' ? '<button type="button" class="btn btn-no" data-fb-delete="' + esc(f.id) + '" style="margin-left:8px;">Delete permanently</button>' : '') +
        '</div>' +
      '</div>';
    }

    return '<div class="fb-item" data-fb-item="' + esc(f.id) + '">' +
      '<div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">' +
        '<div><strong>' + catLabel + '</strong> ' + feedbackStatusBadge(f.status) + '</div>' +
        '<span style="font-size:11px; color:var(--faint);">' + esc(when) + '</span>' +
      '</div>' +
      msgBlock + ctx + shot +
      '<div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--accent); margin-top:14px;">Three proposed fixes — approve on a card (★ = recommended)</div>' +
      '<div class="fb-proposals">' +
        renderProposalCard(f, 0) + renderProposalCard(f, 1) + renderProposalCard(f, 2) +
      '</div>' +
      renderAcceptPreview(f, pick) +
      '<label style="font-size:11px; color:var(--muted); display:block; margin-bottom:4px;">Custom fix (or edit a card — it lands here)</label>' +
      '<textarea class="fb-custom-solution" id="fb-custom-' + esc(f.id) + '" placeholder="Write your own fix…">' + customVal + '</textarea>' +
      '<input type="text" id="fb-note-' + esc(f.id) + '" placeholder="Review note (optional)" value="' + noteVal + '" style="width:100%; margin-bottom:8px; font-size:12px;">' +
      chosen +
      '<div class="fb-toolbar">' +
        '<button type="button" class="btn btn-go" data-fb-accept-custom="' + esc(f.id) + '">✓ Apply custom fix</button>' +
        '<button type="button" class="btn" data-fb-reroll-all="' + esc(f.id) + '">↻ Reroll all three</button>' +
        '<button type="button" class="btn btn-no" data-fb-status="' + esc(f.id) + '" data-status="declined">Decline</button>' +
      '</div></div>';
  }

  function renderFeedbackList() {
    var list = filterFeedbackItems();
    var el = document.getElementById('feedback-list');
    var filter = (document.getElementById('feedback-filter') || {}).value || 'active';
    renderFeedbackSummary();
    if (!list.length) {
      var emptyMsg = {
        active: 'Active queue is clear — nothing needs attention right now.',
        archived: 'No archived items yet. Mark reports Done or Decline to archive them.',
        '': 'No feedback yet — reports from the site will appear here.'
      };
      el.innerHTML = '<div class="empty">' + (emptyMsg[filter] || 'No feedback with that filter.') + '</div>';
      return;
    }
    el.innerHTML = list.map(renderFeedbackItem).join('');
  }

  async function loadFeedback() {
    try {
      var filterEl = document.getElementById('feedback-filter');
      if (filterEl && !filterEl.dataset.inited) {
        var saved = sessionStorage.getItem('omni_feedback_filter');
        if (saved !== null && filterEl.querySelector('option[value="' + saved + '"]')) {
          filterEl.value = saved;
        }
        filterEl.dataset.inited = '1';
      }
      const data = await api('/api/feedback');
      cacheFeedback = data.items || [];
      cacheFeedback.forEach(function (f) {
        if (!feedbackPick[f.id] && f.status !== 'done' && f.status !== 'declined') {
          feedbackPick[f.id] = defaultFeedbackPick(f);
        }
      });
      renderFeedbackList();
      refreshNavBadges();
    } catch (err) {
      document.getElementById('feedback-list').innerHTML = '<div class="empty">Could not load feedback: ' + esc(err.message) + '</div>';
    }
  }

  function patchFeedbackItem(updated) {
    if (!updated || !updated.id) return;
    const idx = cacheFeedback.findIndex((f) => f.id === updated.id);
    if (idx >= 0) cacheFeedback[idx] = updated;
    const pick = feedbackPick[updated.id];
    if (pick && pick.slot !== null && pick.slot !== undefined) {
      const proposals = updated.proposals || [];
      if (proposals[pick.slot]) {
        feedbackPick[updated.id] = {
          text: proposals[pick.slot],
          slot: pick.slot,
          source: pick.slot === feedbackRecommendedSlot(updated) ? 'recommended' : 'card'
        };
      } else {
        feedbackPick[updated.id] = defaultFeedbackPick(updated);
      }
    } else if (!pick && updated.status !== 'done' && updated.status !== 'declined') {
      feedbackPick[updated.id] = defaultFeedbackPick(updated);
    }
    renderFeedbackList();
  }

  document.getElementById('feedback-filter').addEventListener('change', function () {
    sessionStorage.setItem('omni_feedback_filter', this.value);
    renderFeedbackList();
  });

  document.getElementById('feedback-list').addEventListener('input', function (e) {
    if (!e.target.classList.contains('fb-custom-solution')) return;
    const id = e.target.id.replace('fb-custom-', '');
    const item = cacheFeedback.find(function (f) { return f.id === id; });
    if (!item) return;
    const value = e.target.value;
    const trimmed = value.trim();
    let slot = null;
    let source = 'custom';
    const proposals = item.proposals || [];
    for (let i = 0; i < 3; i++) {
      if (proposals[i] && proposals[i].trim() === trimmed) {
        slot = i;
        source = i === feedbackRecommendedSlot(item) ? 'recommended' : 'card';
        break;
      }
    }
    feedbackPick[id] = { text: value, slot: slot, source: source };
    const pick = resolveFeedbackPick(item);
    const preview = document.getElementById('fb-accept-preview-' + id);
    if (preview) {
      preview.querySelector('.text').innerHTML = trimmed
        ? esc(trimmed)
        : '<span style="color:var(--faint); font-style:italic;">Pick a card or write a custom fix below</span>';
      const meta = preview.querySelector('.meta');
      if (meta) meta.textContent = feedbackPickLabel(pick, item);
    }
    document.querySelectorAll('[data-fb-pick="' + id + '"]').forEach(function (card) {
      const cardSlot = parseInt(card.getAttribute('data-fb-slot'), 10);
      const cardText = proposals[cardSlot] || '';
      const on = slot === cardSlot && trimmed === cardText.trim();
      card.classList.toggle('on', on);
    });
  });

  document.getElementById('feedback-list').addEventListener('click', async function (e) {
    const pick = e.target.closest('[data-fb-pick]');
    if (pick && !e.target.closest('button')) {
      const id = pick.getAttribute('data-fb-pick');
      const slot = parseInt(pick.getAttribute('data-fb-slot'), 10);
      const item = cacheFeedback.find((f) => f.id === id);
      if (item && item.proposals && item.proposals[slot]) {
        const rec = feedbackRecommendedSlot(item);
        feedbackPick[id] = {
          text: item.proposals[slot],
          slot: slot,
          source: slot === rec ? 'recommended' : 'card'
        };
        const ta = document.getElementById('fb-custom-' + id);
        if (ta) ta.value = item.proposals[slot];
        renderFeedbackList();
      }
      return;
    }

    const reroll = e.target.closest('[data-fb-reroll]');
    if (reroll) {
      const id = reroll.getAttribute('data-fb-reroll');
      const slot = reroll.getAttribute('data-fb-slot');
      reroll.disabled = true;
      try {
        const res = await api('/api/feedback/proposals/reroll', { method: 'POST', body: { id, slot } });
        patchFeedbackItem(res.item);
        toast('Drew a new card.');
      } catch (err) { toast(err.message, true); reroll.disabled = false; }
      return;
    }

    const rerollAll = e.target.closest('[data-fb-reroll-all]');
    if (rerollAll) {
      const id = rerollAll.getAttribute('data-fb-reroll-all');
      rerollAll.disabled = true;
      try {
        const res = await api('/api/feedback/proposals/reroll', { method: 'POST', body: { id, slot: 'all' } });
        delete feedbackPick[id];
        patchFeedbackItem(res.item);
        toast('Rerolled all three proposals.');
      } catch (err) { toast(err.message, true); rerollAll.disabled = false; }
      return;
    }

    const dismiss = e.target.closest('[data-fb-dismiss]');
    if (dismiss) {
      const id = dismiss.getAttribute('data-fb-dismiss');
      const slot = dismiss.getAttribute('data-fb-slot');
      dismiss.disabled = true;
      try {
        const res = await api('/api/feedback/proposals/update', { method: 'POST', body: { id, slot, text: '' } });
        patchFeedbackItem(res.item);
      } catch (err) { toast(err.message, true); dismiss.disabled = false; }
      return;
    }

    const edit = e.target.closest('[data-fb-edit]');
    if (edit) {
      const id = edit.getAttribute('data-fb-edit');
      const slot = parseInt(edit.getAttribute('data-fb-slot'), 10);
      const item = cacheFeedback.find((f) => f.id === id);
      const current = item && item.proposals ? item.proposals[slot] : '';
      const next = window.prompt('Edit proposed fix:', current || '');
      if (next === null) return;
      edit.disabled = true;
      try {
        const res = await api('/api/feedback/proposals/update', { method: 'POST', body: { id, slot, text: next.trim() } });
        if (next.trim()) {
          const rec = feedbackRecommendedSlot(item);
          feedbackPick[id] = {
            text: next.trim(),
            slot: slot,
            source: slot === rec ? 'recommended' : 'card'
          };
        }
        patchFeedbackItem(res.item);
      } catch (err) { toast(err.message, true); edit.disabled = false; }
      return;
    }

    const acceptCard = e.target.closest('[data-fb-accept-card]');
    if (acceptCard) {
      const id = acceptCard.getAttribute('data-fb-accept-card');
      const slot = parseInt(acceptCard.getAttribute('data-fb-slot'), 10);
      const item = cacheFeedback.find(function (f) { return f.id === id; });
      const text = item && item.proposals ? (item.proposals[slot] || '').trim() : '';
      if (!text) { toast('That card is empty — reroll first.', true); return; }
      acceptCard.disabled = true;
      try {
        const noteEl = document.getElementById('fb-note-' + id);
        const res = await api('/api/feedback/proposals/accept', {
          method: 'POST',
          body: {
            id,
            solution: text,
            note: noteEl ? noteEl.value.trim() : '',
            status: 'done',
            acceptedSlot: slot
          }
        });
        patchFeedbackItem(res.item);
        toast('Approved/implemented fix and archived the report.');
      } catch (err) { toast(err.message, true); acceptCard.disabled = false; }
      return;
    }

    const acceptCustom = e.target.closest('[data-fb-accept-custom]');
    if (acceptCustom) {
      const id = acceptCustom.getAttribute('data-fb-accept-custom');
      const item = cacheFeedback.find(function (f) { return f.id === id; });
      const ta = document.getElementById('fb-custom-' + id);
      const noteEl = document.getElementById('fb-note-' + id);
      const pick = item ? resolveFeedbackPick(item) : { text: '', slot: null, source: 'custom' };
      const solution = ((ta && ta.value) || pick.text || '').trim();
      if (!solution) { toast('Pick a card or write a custom fix first.', true); return; }
      const acceptedSlot = item ? resolveAcceptedSlot(item, solution, pick) : null;
      acceptCustom.disabled = true;
      try {
        const res = await api('/api/feedback/proposals/accept', {
          method: 'POST',
          body: {
            id,
            solution,
            note: noteEl ? noteEl.value.trim() : '',
            status: 'done',
            acceptedSlot: acceptedSlot
          }
        });
        patchFeedbackItem(res.item);
        toast('Approved/implemented fix and archived the report.');
      } catch (err) { toast(err.message, true); acceptCustom.disabled = false; }
      return;
    }

    const btn = e.target.closest('[data-fb-status]');
    if (btn) {
      const id = btn.getAttribute('data-fb-status');
      const status = btn.getAttribute('data-status');
      btn.disabled = true;
      try {
        const res = await api('/api/feedback/action', { method: 'POST', body: { id, status } });
        if (res.item) patchFeedbackItem(res.item);
        else loadFeedback();
        refreshNavBadges();
        if (status === 'done' || status === 'declined') {
          toast('Archived — removed from active queue. View under Archived filter anytime.');
        } else if (status === 'reviewing') {
          toast('Reopened — back in the active queue.');
        } else {
          toast('Feedback marked as ' + status + '.');
        }
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
      return;
    }

    const delBtn = e.target.closest('[data-fb-delete]');
    if (delBtn) {
      const id = delBtn.getAttribute('data-fb-delete');
      if (!confirm('Permanently delete this feedback item? This cannot be undone.')) return;
      delBtn.disabled = true;
      try {
        await api('/api/feedback/delete', { method: 'POST', body: { id } });
        cacheFeedback = cacheFeedback.filter(function (f) { return f.id !== id; });
        renderFeedbackList();
        refreshNavBadges();
        toast('Feedback deleted.');
      } catch (err) { toast(err.message, true); delBtn.disabled = false; }
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
        const cul = (uj.users || []).map((u) => {
          const pending = u.mustSetupMfa || !u.mfaEnabled;
          const pendingBadge = pending ? ' <span class="badge b-in_review">setup pending</span>' : '';
          const pkBadge = u.passkeyCount ? ' <span class="badge b-approved">' + u.passkeyCount + ' key(s)</span>' : '';
          const rcBadge = u.recoveryCodesRemaining != null && u.mfaEnabled
            ? ' <span class="badge">' + u.recoveryCodesRemaining + ' recovery</span>' : '';
          return '<div class="item"><div class="t">' + esc(u.username) +
          '<span class="badge b-approved">' + esc(u.role) + '</span>' + pendingBadge + pkBadge + rcBadge + '</div>' +
          '<div class="m">Created ' + esc(u.createdAt.slice(0, 10)) + '</div>' +
          (u.bootstrap ? '' : '<div class="actions" style="margin-top:4px">' +
            (u.mfaEnabled ? '<button class="btn btn-no" data-regen-rc="' + esc(u.id) + '" data-uname="' + esc(u.username) + '">New recovery codes</button> ' : '') +
            '<button class="btn btn-no" data-deluser="' + esc(u.id) + '" data-uname="' + esc(u.username) + '">Delete</button></div>') +
          '</div>';
        });
        document.getElementById('console-users-list').innerHTML = cul.length ? cul.join('') : '<div class=empty>No custom accounts created yet.</div>';
      } catch (e) { document.getElementById('console-users-list').innerHTML = '<div class=empty>Failed to load accounts.</div>'; }
    } else {
      document.getElementById('admin-user-mgmt').style.display = 'none';
    }

    await loadPasskeys();
  }

  async function loadPasskeys() {
    var listEl = document.getElementById('passkeys-list');
    var regBtn = document.getElementById('passkey-register-btn');
    if (!listEl) return;
    if (isDemoSession() || !getToken()) {
      listEl.innerHTML = '<div class="empty">Sign in to manage security keys.</div>';
      if (regBtn) regBtn.disabled = true;
      return;
    }
    if (regBtn) regBtn.disabled = false;
    try {
      var data = await api('/api/passkeys');
      var keys = data.passkeys || [];
      if (!keys.length) {
        listEl.innerHTML = '<div class="empty">No security keys registered yet.</div>';
        return;
      }
      listEl.innerHTML = keys.map(function (k) {
        return '<div class="item"><div class="t">' + esc(k.deviceName || 'Security key') +
          '</div><div class="m">Added ' + esc((k.createdAt || '').slice(0, 10)) +
          '</div><div class="actions" style="margin-top:4px"><button type="button" class="btn btn-no" data-passkey-del="' +
          esc(k.credentialID) + '">Remove</button></div></div>';
      }).join('');
    } catch (e) {
      listEl.innerHTML = '<div class="empty">Could not load keys: ' + esc(e.message) + '</div>';
    }
  }

  async function passkeyLogin() {
    if (!window.OmniWebAuthn || !OmniWebAuthn.supported()) {
      toast('This browser does not support security keys or passkeys.', true);
      return;
    }
    var user = document.getElementById('username-input').value.trim();
    var mfaCode = document.getElementById('login-mfa-input').value.trim();
    var recoveryCode = document.getElementById('login-recovery-input').value.trim();
    if (!user) {
      toast('Enter your username first.', true);
      document.getElementById('username-input').focus();
      return;
    }
    if (!mfaCode && !recoveryCode) {
      toast('Enter your authenticator code (or a recovery code) for passkey sign-in.', true);
      document.getElementById('login-mfa-input').focus();
      return;
    }
    var btn = document.getElementById('passkey-login-btn');
    btn.disabled = true;
    btn.textContent = 'Waiting for key…';
    try {
      var optRes = await fetch(API + '/api/passkeys/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user || undefined, discoverable: !user }),
      });
      var optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || 'Could not start passkey sign-in.');
      var assertion = await OmniWebAuthn.authenticatePasskey(optData.options);
      var verifyRes = await fetch(API + '/api/passkeys/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: assertion,
          challengeId: optData.challengeId,
          mfaCode: mfaCode || undefined,
          recoveryCode: recoveryCode || undefined,
        }),
      });
      var verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Security key sign-in failed.');
      if (verifyData.mfaRequired) {
        toast('Enter your authenticator code or a recovery code.', true);
        document.getElementById('login-mfa-input').focus();
        return;
      }
      setToken(verifyData.token);
      sessionStorage.setItem('omni_dash_role', verifyData.role);
      sessionStorage.setItem('omni_dash_username', verifyData.username);
      currentUserRole = verifyData.role;
      markPendingSetup(false);
      document.getElementById('unlock-err').style.display = 'none';
      showDash();
      loadOverview();
      startRefresh();
      toast('Welcome back, ' + verifyData.username + ' (security key)');
    } catch (err) {
      var errEl = document.getElementById('unlock-err');
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in with passkey';
    }
  }

  async function passkeyRegister() {
    if (!window.OmniWebAuthn || !OmniWebAuthn.supported()) {
      toast('This browser does not support security keys or passkeys.', true);
      return;
    }
    if (isDemoSession()) {
      toast('Demo mode — connect the live backend to register keys.', true);
      return;
    }
    var label = (document.getElementById('passkey-device-name').value || 'Security key').trim();
    var btn = document.getElementById('passkey-register-btn');
    btn.disabled = true;
    btn.textContent = 'Waiting for key…';
    try {
      var optRes = await fetch(API + '/api/passkeys/register/options', {
        method: 'POST',
        headers: authHeaders(),
      });
      var optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || 'Could not start registration.');
      var attestation = await OmniWebAuthn.registerPasskey(optData.options);
      var verifyRes = await fetch(API + '/api/passkeys/register/verify', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'X-OV-Console': '1' }, authHeaders()),
        body: JSON.stringify({
          response: attestation,
          challengeId: optData.challengeId,
          deviceName: label,
        }),
      });
      var verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Registration failed.');
      document.getElementById('passkey-device-name').value = '';
      toast('Security key registered.');
      loadPasskeys();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register key';
    }
  }
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
    if (act === 'contact') {
      b.disabled = true;
      try {
        const r = await api('/api/pipeline/action', { method: 'POST', body: { id, action: act } });
        toast(r.message || 'Marked contacted.');
        loadPipeline();
        loadFollowUpQueue();
        refreshNavBadges();
      } catch (err) { toast(err.message, true); b.disabled = false; }
      return;
    }
    if (act === 'claim') {
      b.disabled = true;
      try {
        const r = await api('/api/pipeline/action', { method: 'POST', body: { id, action: act } });
        toast(r.message || 'Claimed.');
        loadPipeline();
        loadFollowUpQueue();
      } catch (err) { toast(err.message, true); b.disabled = false; }
      return;
    }
    var msg = act === 'approve'
      ? 'Qualify "' + name + '" for merchant onboarding? (Use after your team has spoken with them.)'
      : act === 'reject'
        ? 'Mark "' + name + '" as not interested?'
        : act.toUpperCase() + ' ' + name + ' (id ' + id + ')?';
    if (!confirm(msg)) return;
    b.disabled = true;
    try {
      const r = await api('/api/pipeline/action', { method: 'POST', body: { id, action: act } });
      toast(r.message || 'Done.');
    } catch (err) { toast(err.message, true); }
    loadPipeline();
    loadFollowUpQueue();
  });

  document.getElementById('v-leads').addEventListener('click', async (e) => {
    const claimBtn = e.target.closest('[data-lead-claim]');
    if (claimBtn) {
      const id = claimBtn.getAttribute('data-lead-claim');
      claimBtn.disabled = true;
      try {
        const r = await api('/api/leads/claim', { method: 'POST', body: { id } });
        if (r.item) {
          const idx = cacheLeads.findIndex(function (l) { return l.id === id; });
          if (idx >= 0) cacheLeads[idx] = r.item;
        }
        renderLeadsList();
        toast('Lead claimed — you own follow-up.');
      } catch (err) { toast(err.message, true); claimBtn.disabled = false; }
      return;
    }

    const deleteBtn = e.target.closest('[data-lead-delete]');
    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-lead-delete');
      const name = deleteBtn.getAttribute('data-lead-name') || 'this lead';
      if (!confirm('Permanently delete ' + name + '? This cannot be undone.')) return;
      deleteBtn.disabled = true;
      try {
        await api('/api/leads/delete', { method: 'POST', body: { id } });
        cacheLeads = cacheLeads.filter(function (l) { return l.id !== id; });
        renderLeadsList();
        refreshNavBadges();
        toast('Lead deleted.');
      } catch (err) { toast(err.message, true); deleteBtn.disabled = false; }
      return;
    }

    const promoteBtn = e.target.closest('[data-lead-promote]');
    if (promoteBtn) {
      const id = promoteBtn.getAttribute('data-lead-promote');
      const name = promoteBtn.getAttribute('data-lead-name') || 'this lead';
      if (!confirm('Move "' + name + '" to the merchant Pipeline as a new application?')) return;
      promoteBtn.disabled = true;
      try {
        const r = await api('/api/leads/promote', { method: 'POST', body: { id } });
        toast('Moved to Pipeline — open the Pipeline tab to approve or advance.');
        if (r.item) {
          const idx = cacheLeads.findIndex(function (l) { return l.id === id; });
          if (idx >= 0) cacheLeads[idx] = r.item;
        }
        renderLeadsList();
      } catch (err) { toast(err.message, true); promoteBtn.disabled = false; }
      return;
    }

    const actionBtn = e.target.closest('[data-lead-action]');
    if (actionBtn) {
      const id = actionBtn.getAttribute('data-lead-action');
      const status = actionBtn.getAttribute('data-lead-status');
      actionBtn.disabled = true;
      try {
        const r = await api('/api/leads/action', { method: 'POST', body: { id, status } });
        if (r.item) {
          const idx = cacheLeads.findIndex(function (l) { return l.id === id; });
          if (idx >= 0) cacheLeads[idx] = r.item;
        }
        renderLeadsList();
        refreshNavBadges();
        toast(status === 'archived' ? 'Lead archived.' : status === 'contacted' ? 'Marked contacted.' : 'Lead reopened.');
      } catch (err) { toast(err.message, true); actionBtn.disabled = false; }
      return;
    }

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

    // Regenerate recovery codes (admin)
    const regenBtn = e.target.closest('button[data-regen-rc]');
    if (regenBtn) {
      const { regenRc, uname } = regenBtn.dataset;
      if (!confirm('Generate new recovery codes for ' + uname + '? Old unused codes will stop working.')) return;
      regenBtn.disabled = true;
      try {
        const out = await api('/api/console_users/recovery-codes/regenerate', {
          method: 'POST',
          body: { userId: regenRc },
        });
        const codes = (out.recoveryCodes || []).join('\n');
        prompt('New recovery codes for ' + uname + ' (copy now — shown once):', codes);
        toast('Recovery codes regenerated for ' + uname);
      } catch (err) { toast(err.message, true); }
      regenBtn.disabled = false;
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

    const pkDel = e.target.closest('button[data-passkey-del]');
    if (pkDel) {
      var credId = pkDel.getAttribute('data-passkey-del');
      if (!confirm('Remove this security key? You will not be able to sign in with it.')) return;
      pkDel.disabled = true;
      try {
        await api('/api/passkeys/delete', { method: 'POST', body: { credentialID: credId } });
        toast('Security key removed.');
        loadPasskeys();
      } catch (err) { toast(err.message, true); pkDel.disabled = false; }
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
    if (!username || !password) { toast('Username and starter PIN are required.', true); return; }
    if (!/^\d{6,12}$/.test(password)) {
      toast('Starter PIN must be 6–12 numeric digits.', true);
      return;
    }

    document.getElementById('console-user-create').disabled = true;
    try {
      await api('/api/console_users', { method: 'POST', body: { username, password, role } });
      toast('Account commissioned for ' + username + ' — they complete 2FA on first login.');
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
  function showSetupModal(starterUsername) {
    document.getElementById('mfa-setup-step1').style.display = 'block';
    document.getElementById('mfa-setup-step2').style.display = 'none';
    document.getElementById('mfa-setup-step3').style.display = 'none';
    document.getElementById('mfa-setup-err').style.display = 'none';
    document.getElementById('mfa-setup-username').value = starterUsername || '';
    document.getElementById('mfa-setup-password').value = '';
    document.getElementById('mfa-verification-code').value = '';
    document.getElementById('mfa-secret-text').textContent = '—';
    const copyBtn = document.getElementById('mfa-secret-copy');
    if (copyBtn) copyBtn.disabled = true;
    const qrImg = document.getElementById('mfa-qr-image');
    qrImg.removeAttribute('src');
    qrImg.style.display = 'none';
    const qrPlaceholder = document.getElementById('mfa-qr-placeholder');
    qrPlaceholder.style.display = 'flex';
    qrPlaceholder.textContent = 'QR loading…';
    document.getElementById('mfa-setup-modal').style.display = 'flex';
  }

  document.getElementById('email-login-btn').addEventListener('click', function () {
    var user = document.getElementById('username-input').value.trim();
    if (!user) {
      toast('Please enter your username first.', true);
      document.getElementById('username-input').focus();
      return;
    }
    toast('Email sign-in code requested for ' + user + '. Check your mailbox.');
  });

  document.getElementById('sms-login-btn').addEventListener('click', function () {
    var user = document.getElementById('username-input').value.trim();
    if (!user) {
      toast('Please enter your username first.', true);
      document.getElementById('username-input').focus();
      return;
    }
    toast('SMS sign-in code requested for ' + user + '. Check your phone.');
  });

  document.getElementById('unlock-btn').addEventListener('click', async function () {
    var user = document.getElementById('username-input').value.trim();
    var pass = document.getElementById('token-input') ? document.getElementById('token-input').value.trim() : '';
    var mfaCode = document.getElementById('login-mfa-input').value.trim();
    var recoveryCode = document.getElementById('login-recovery-input') ? document.getElementById('login-recovery-input').value.trim() : '';

    // If username is blank and mfaCode contains hyphens, treat it as a recovery code login
    if (!user && mfaCode && mfaCode.includes('-')) {
      recoveryCode = mfaCode;
      mfaCode = '';
    } else if (!user) {
      toast('Username is required.', true);
      return;
    }

    var btn = document.getElementById('unlock-btn');
    btn.disabled = true;
    btn.textContent = 'Logging in…';

    try {
      // Demo / offline accounts sign in directly in the browser — no backend call.
      const demoUser = matchDemoUser(user, pass);
      if (demoUser) {
        startDemoSession(demoUser);
        if (document.getElementById('token-input')) document.getElementById('token-input').value = '';
        document.getElementById('username-input').value = '';
        document.getElementById('login-mfa-input').value = '';
        if (document.getElementById('login-recovery-input')) document.getElementById('login-recovery-input').value = '';
        document.getElementById('unlock-err').style.display = 'none';
        showDash();
        renderDemoOverview();
        toast('Welcome, ' + demoUser.username + ' — demo mode');
        return;
      }

      const payload = { username: user };
      if (pass) payload.password = pass;
      if (mfaCode) payload.mfaCode = mfaCode;
      if (recoveryCode) payload.recoveryCode = recoveryCode;

      const res = await fetch(API + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');

      if (data.mfaRequired) {
        document.getElementById('login-mfa-input').focus();
        toast('Enter your authenticator code or a recovery code.');
        return;
      }

      if (data.mustSetupMfa) {
        setToken(data.token);
        sessionStorage.setItem('omni_dash_role', data.role);
        sessionStorage.setItem('omni_dash_username', data.username);
        currentUserRole = data.role;
        markPendingSetup(true);
        document.getElementById('unlock-err').style.display = 'none';
        await resumeSetupWizard(data.username);
        return;
      }

      setToken(data.token);
      sessionStorage.setItem('omni_dash_role', data.role);
      sessionStorage.setItem('omni_dash_username', data.username);
      currentUserRole = data.role;

      if (document.getElementById('token-input')) document.getElementById('token-input').value = '';
      document.getElementById('username-input').value = '';
      document.getElementById('login-mfa-input').value = '';
      if (document.getElementById('login-recovery-input')) document.getElementById('login-recovery-input').value = '';

      showDash();
      loadOverview();
      startRefresh();
      toast('Welcome back, ' + data.username);
    } catch (err) {
      const errEl = document.getElementById('unlock-err');
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  document.getElementById('passkey-login-btn').addEventListener('click', passkeyLogin);
  document.getElementById('passkey-register-btn').addEventListener('click', passkeyRegister);

  document.getElementById('toggle-to-register').addEventListener('click', function() {
    document.getElementById('login-panel').style.display = 'none';
    document.getElementById('register-panel').style.display = 'block';
  });
  document.getElementById('toggle-to-login').addEventListener('click', function() {
    document.getElementById('register-panel').style.display = 'none';
    document.getElementById('login-panel').style.display = 'block';
  });

  document.getElementById('register-btn').addEventListener('click', async function() {
    var user = document.getElementById('reg-username-input').value.trim();
    var pass = document.getElementById('reg-token-input').value.trim();
    var passcode = document.getElementById('reg-passcode-input').value.trim();
    var errEl = document.getElementById('register-err');
    errEl.style.display = 'none';

    if (!user || !pass || !passcode) {
      errEl.textContent = 'All fields are required.';
      errEl.style.display = 'block';
      return;
    }
    if (!/^\d{6,12}$/.test(pass)) {
      errEl.textContent = 'Temporary PIN must be a 6–12 digit numeric code.';
      errEl.style.display = 'block';
      return;
    }

    var btn = document.getElementById('register-btn');
    btn.disabled = true;
    btn.textContent = 'Registering…';

    try {
      const res = await fetch(API + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass, registrationCode: passcode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed.');

      toast('Registration successful! Log in to configure MFA.');
      
      // Clear fields
      document.getElementById('reg-username-input').value = '';
      document.getElementById('reg-token-input').value = '';
      document.getElementById('reg-passcode-input').value = '';

      // Toggle back to login and populate username/password
      document.getElementById('register-panel').style.display = 'none';
      document.getElementById('login-panel').style.display = 'block';
      document.getElementById('username-input').value = user;
      document.getElementById('token-input').value = pass;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register Account';
    }
  });

  document.getElementById('recovery-codes-copy').addEventListener('click', function () {
    var codes = window._omniPendingRecoveryCodes || [];
    if (!codes.length) { toast('No recovery codes to copy.', true); return; }
    navigator.clipboard.writeText(codes.join('\n')).then(function () {
      toast('Recovery codes copied.');
    }).catch(function () {
      toast('Could not copy — select and copy manually.', true);
    });
  });

  document.getElementById('mfa-setup-finish').addEventListener('click', function () {
    var username = sessionStorage.getItem('omni_dash_username') || '';
    document.getElementById('mfa-setup-modal').style.display = 'none';
    document.getElementById('token-input').value = '';
    document.getElementById('username-input').value = '';
    document.getElementById('mfa-setup-password').value = '';
    document.getElementById('mfa-verification-code').value = '';
    window._omniPendingRecoveryCodes = null;
    showDash();
    loadOverview();
    startRefresh();
    toast('Welcome, ' + username + ' — register a passkey in Access & Admins for daily sign-in.');
  });

  document.getElementById('mfa-secret-copy').addEventListener('click', copyMfaSecret);

  document.getElementById('mfa-setup-prepare').addEventListener('click', async function() {
    const newUsername = document.getElementById('mfa-setup-username').value.trim();
    const newPassword = document.getElementById('mfa-setup-password').value.trim();
    const errDiv = document.getElementById('mfa-setup-err');
    errDiv.style.display = 'none';

    if (!newUsername || !newPassword) {
      errDiv.textContent = 'Permanent username and PIN are required.';
      errDiv.style.display = 'block';
      return;
    }
    if (!/^\d{6,12}$/.test(newPassword)) {
      errDiv.textContent = 'PIN must be 6–12 numeric digits.';
      errDiv.style.display = 'block';
      toast('PIN must be 6–12 numeric digits.', true);
      return;
    }

    const btn = document.getElementById('mfa-setup-prepare');
    btn.disabled = true;
    btn.textContent = 'Preparing…';

    try {
      const res = await api('/api/console_users/setup-mfa/prepare', {
        method: 'POST',
        body: { newUsername, newPassword }
      });
      sessionStorage.setItem('omni_dash_username', res.username);

      applySetupQr(res);

      document.getElementById('mfa-setup-step1').style.display = 'none';
      document.getElementById('mfa-setup-step2').style.display = 'block';
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.style.display = 'block';
      errDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast(err.message || 'Setup failed — try again.', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Continue → Set up authenticator';
    }
  });

  document.getElementById('mfa-setup-submit').addEventListener('click', async function() {
    const mfaCode = document.getElementById('mfa-verification-code').value.trim();
    const errDiv = document.getElementById('mfa-setup-err');
    if (!mfaCode) {
      errDiv.textContent = 'Verification code is required.';
      errDiv.style.display = 'block';
      return;
    }

    errDiv.style.display = 'none';
    const btn = document.getElementById('mfa-setup-submit');
    btn.disabled = true;
    btn.textContent = 'Verifying…';

    try {
      const res = await api('/api/console_users/setup-mfa', {
        method: 'POST',
        body: { mfaCode }
      });

      sessionStorage.setItem('omni_dash_username', res.username);
      markPendingSetup(false);

      var codes = res.recoveryCodes || [];
      var listEl = document.getElementById('recovery-codes-list');
      listEl.innerHTML = codes.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
      window._omniPendingRecoveryCodes = codes.slice();

      document.getElementById('mfa-setup-step2').style.display = 'none';
      document.getElementById('mfa-setup-step3').style.display = 'block';
      toast('Account verified — save your recovery codes before continuing.');
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify & Save Recovery Codes';
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

  // Inactivity lock: employees only (7 min idle); admins stay signed in until they lock or close the tab.
  var EMPLOYEE_INACTIVITY_MS = 7 * 60 * 1000;
  var EMPLOYEE_WARNING_MS = 6 * 60 * 1000; // warn 1 minute before lock
  var _inactivityTimer = null;
  var _warningTimer = null;
  var _countdownInterval = null;

  function inactivityLockEnabled() {
    return !!getToken() && !isDemoSession() && currentUserRole !== 'Admin';
  }

  function clearInactivityTimers() {
    clearTimeout(_inactivityTimer);
    clearTimeout(_warningTimer);
    clearInterval(_countdownInterval);
    _inactivityTimer = null;
    _warningTimer = null;
    _countdownInterval = null;
    var banner = document.getElementById('session-warning-banner');
    if (banner) banner.style.display = 'none';
  }

  function resetInactivityTimer() {
    if (!inactivityLockEnabled()) {
      clearInactivityTimers();
      return;
    }
    clearInactivityTimers();
    _warningTimer = setTimeout(showSessionWarning, EMPLOYEE_WARNING_MS);
    _inactivityTimer = setTimeout(autoLock, EMPLOYEE_INACTIVITY_MS);
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
  document.getElementById('leads-filter').addEventListener('change', function () {
    sessionStorage.setItem('omni_leads_filter', this.value);
    renderLeadsList();
  });

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
          '<p><strong>Business:</strong> ' + esc(item.business || 'N/A') + '</p>' +
          '<p><strong>Phone:</strong> ' + esc(item.phone || 'N/A') + '</p>' +
          '<p><strong>Source:</strong> ' + esc(item.source || 'N/A') + '</p>' +
          paymentProfileHtml(item) +
          '<p><strong>Created:</strong> ' + esc(item.createdAt || 'N/A') + '</p>' +
          '<p><strong>Last Updated:</strong> ' + esc(item.updatedAt || 'N/A') + '</p>' +
          qualificationSummaryHtml(item.qualification);
          
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
          '<p><strong>Status:</strong> ' + esc(leadStatus(item)) + '</p>' +
          '<p><strong>Phone:</strong> ' + esc(item.phone || 'N/A') + '</p>' +
          '<p><strong>Business:</strong> ' + esc(item.business || 'N/A') + '</p>' +
          '<p><strong>Consent Given:</strong> ' + (item.consent ? '<span class="up">Yes</span>' : '<span class="down">No</span>') + '</p>' +
          '<p><strong>Channel/Via:</strong> ' + esc(item.via || 'N/A') + '</p>' +
          '<p><strong>Source Form:</strong> ' + esc(item.source || 'N/A') + '</p>' +
          '<p><strong>Submitted:</strong> ' + esc(formatLeadWhen(item)) + '</p>' +
          qualificationSummaryHtml(item.qualification) +
          (item.followUpNote ? '<p><strong>Follow-up note:</strong> ' + esc(item.followUpNote) + '</p>' : '') +
          (item.promotedToPipelineId ? '<p><strong>Pipeline:</strong> promoted (see Pipeline tab)</p>' : '') +
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
      return '<tr class="demo-row">' +
        '<td style="padding:10px; border-bottom: 1px solid var(--card-edge); font-family: monospace; font-weight: bold;"><span class="demo-txid">' + esc(o.txid) + '</span></td>' +
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
    link.setAttribute("download", "omnitender_ledger_example.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('CSV Export started.');
  });

  // --- Social Media Scheduler ---
  var cacheSocialDrafts = [];
  var activeSocialFilter = 'pending';

  async function loadSocial() {
    const listEl = document.getElementById('social-accounts-list');
    listEl.innerHTML = 'Loading accounts...';
    try {
      const acc = await api('/api/social/accounts');
      if (acc && acc.accounts && acc.accounts.length > 0) {
        listEl.innerHTML = acc.accounts.map(a => 
          '<span class="badge b-approved" style="margin-right: 8px; background: rgba(247, 121, 44, 0.1); color: var(--accent); border: 1px solid rgba(247, 121, 44, 0.2);">' + 
          esc(a.platform.toUpperCase()) + ': ' + esc(a.id) + '</span>'
        ).join('');
      } else {
        listEl.innerHTML = 'No connected Zernio accounts found. Add accounts in Zernio Console.';
      }
    } catch (e) {
      listEl.innerHTML = 'Failed to load Zernio accounts: ' + esc(e.message);
    }

    await loadSocialDrafts();
  }

  async function loadSocialDrafts() {
    const listEl = document.getElementById('social-drafts-list');
    listEl.innerHTML = '<div class="empty">Loading drafts...</div>';
    try {
      const res = await api('/api/social/drafts');
      cacheSocialDrafts = res.drafts || [];
      renderSocialDrafts();
    } catch (e) {
      listEl.innerHTML = '<div class="empty" style="color: var(--down);">Failed to load drafts: ' + esc(e.message) + '</div>';
    }
  }

  function renderSocialDrafts() {
    const listEl = document.getElementById('social-drafts-list');
    const filtered = cacheSocialDrafts.filter(d => {
      if (activeSocialFilter === 'publishing') {
        return d.status === 'publishing' || d.status === 'approved' || d.status === 'published';
      }
      return d.status === activeSocialFilter;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty">No ' + activeSocialFilter + ' drafts found.</div>';
      return;
    }

    listEl.innerHTML = filtered.map(d => {
      const platformsHtml = (d.platforms || []).map(p => '<span class="badge" style="background: #222; color: #fff; margin-right:4px;">' + esc(p) + '</span>').join('');
      let actionsHtml = '';
      let statusInfo = '';

      if (d.status === 'pending') {
        actionsHtml = 
          '<div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">' +
            '<button class="btn btn-go social-edit-btn" data-id="' + d.id + '" style="font-size:11px; padding:6px 12px; margin:0; width:auto; min-height:0;">💾 Save Edits</button>' +
            '<button class="btn btn-no social-reject-btn" data-id="' + d.id + '" style="font-size:11px; padding:6px 12px; margin:0; width:auto; min-height:0;">🚫 Reject</button>' +
            '<button class="btn social-approve-draft-btn" data-id="' + d.id + '" style="font-size:11px; padding:6px 12px; margin:0; width:auto; min-height:0; background: var(--inset); color: #fff; border: 1px solid var(--card-edge);">Push to Zernio Draft</button>' +
            '<div style="display: inline-flex; align-items: center; gap: 4px;">' +
              '<input type="datetime-local" class="social-sched-time" style="padding: 4px; font-size:11px; height:28px; width:160px; margin:0;" id="sched-time-' + d.id + '">' +
              '<button class="btn btn-go social-sched-btn" data-id="' + d.id + '" style="font-size:11px; padding:6px 12px; margin:0; width:auto; min-height:0;">📅 Schedule</button>' +
            '</div>' +
          '</div>';
      } else if (d.status === 'scheduled') {
        statusInfo = '<p style="font-size: 12px; color: var(--accent); margin: 6px 0;">📅 Scheduled for: <strong>' + esc(d.scheduled_for || '') + '</strong></p>';
        actionsHtml = 
          '<div style="margin-top: 12px;">' +
            '<button class="btn btn-no social-reject-btn" data-id="' + d.id + '" style="font-size:11px; padding:6px 12px; margin:0; width:auto; min-height:0;">🚫 Cancel &amp; Reject</button>' +
          '</div>';
      } else if (d.status === 'rejected') {
        statusInfo = '<p style="font-size: 12px; color: var(--down); margin: 6px 0;">🚫 Rejected by: ' + esc(d.decided_by || 'unknown') + '</p>';
      } else {
        statusInfo = '<p style="font-size: 12px; color: var(--up); margin: 6px 0;">✅ Published/Approved (Zernio ID: ' + esc(d.zernio_id || 'N/A') + ')</p>';
      }

      return '<div class="card" style="margin-bottom: 16px; border: 1px solid var(--card-edge); background: var(--inset);">' +
        '<div style="display:flex; justify-content:space-between; margin-bottom:8px;">' +
          '<div>' + platformsHtml + ' <span style="font-size:11px; color:var(--faint);">ID: ' + esc(d.id) + '</span></div>' +
          '<div style="font-size:11px; color:var(--faint);">' + esc(d.created_at || '') + ' by ' + esc(d.created_by || '') + '</div>' +
        '</div>' +
        '<textarea class="social-draft-text" data-id="' + d.id + '" style="width:100%; border:1px solid #444; background:#111; color:#fff; padding:8px; border-radius:4px; font-size:13px; font-family:inherit;" rows="4" ' + (d.status !== 'pending' ? 'readonly' : '') + '>' + esc(d.text) + '</textarea>' +
        '<p style="font-size:12px; color:var(--muted); margin: 8px 0 0;">💡 <i>' + esc(d.rationale || '') + '</i></p>' +
        statusInfo +
        actionsHtml +
      '</div>';
    }).join('');

    // Wire actions
    document.querySelectorAll('.social-edit-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const textEl = document.querySelector('.social-draft-text[data-id="' + id + '"]');
        const text = textEl.value.trim();
        try {
          await api('/api/social/draft/edit', { method: 'POST', body: { id, text } });
          toast('Draft edits saved successfully.');
          loadSocialDrafts();
        } catch (e) {
          toast('Failed to edit draft: ' + e.message, true);
        }
      });
    });

    document.querySelectorAll('.social-reject-btn').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to reject this draft?')) return;
        const id = b.dataset.id;
        try {
          await api('/api/social/draft/reject', { method: 'POST', body: { id } });
          toast('Draft rejected.');
          loadSocialDrafts();
        } catch (e) {
          toast('Failed to reject draft: ' + e.message, true);
        }
      });
    });

    document.querySelectorAll('.social-approve-draft-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const textEl = document.querySelector('.social-draft-text[data-id="' + id + '"]');
        const text = textEl.value.trim();
        try {
          await api('/api/social/draft/approve', { method: 'POST', body: { id, mode: 'zernio_draft', expected_text: text } });
          toast('Draft pushed to Zernio.');
          loadSocialDrafts();
        } catch (e) {
          toast('Failed to approve draft: ' + e.message, true);
        }
      });
    });

    document.querySelectorAll('.social-sched-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const textEl = document.querySelector('.social-draft-text[data-id="' + id + '"]');
        const text = textEl.value.trim();
        const timeVal = document.getElementById('sched-time-' + id).value;
        if (!timeVal) {
          toast('Please pick a schedule date & time.', true);
          return;
        }
        const isoStr = new Date(timeVal).toISOString();
        try {
          await api('/api/social/draft/approve', { method: 'POST', body: { id, mode: 'schedule', expected_text: text, when: isoStr } });
          toast('Post scheduled successfully.');
          loadSocialDrafts();
        } catch (e) {
          toast('Scheduling failed: ' + e.message, true);
        }
      });
    });
  }

      });
    });
  }

  // --- AI Lead Extractor Frontend Logic ---
  let extractedLeadsCache = [];

  document.getElementById('ai-extract-btn').addEventListener('click', async () => {
    const fileInput = document.getElementById('ai-extract-image');
    const textInput = document.getElementById('ai-extract-text').value.trim();
    const statusEl = document.getElementById('ai-extract-status');
    const resultsEl = document.getElementById('ai-extracted-results');
    const tbodyEl = document.getElementById('ai-extracted-tbody');
    const btn = document.getElementById('ai-extract-btn');

    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--muted)';
    statusEl.textContent = 'Processing with Gemini AI... please wait...';
    resultsEl.style.display = 'none';
    tbodyEl.innerHTML = '';
    btn.disabled = true;

    try {
      let bodyPayload = {};
      if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            // strip mime prefix: data:image/png;base64,
            const commaIdx = result.indexOf(',');
            resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        bodyPayload = {
          imageBase64: base64Data,
          imageMimeType: file.type
        };
      } else if (textInput) {
        bodyPayload = { text: textInput };
      } else {
        throw new Error('Please select an image file or paste raw text first.');
      }

      const res = await api('/api/leads/ai-extract', { method: 'POST', body: bodyPayload });
      if (!res.ok && res.error) throw new Error(res.error);

      extractedLeadsCache = res.leads || [];
      if (extractedLeadsCache.length === 0) {
        statusEl.style.color = 'var(--down)';
        statusEl.textContent = 'No leads could be extracted from the input source.';
        return;
      }

      statusEl.style.color = 'var(--up)';
      statusEl.textContent = `Successfully extracted ${extractedLeadsCache.length} leads!`;
      resultsEl.style.display = 'block';

      // Render lead list preview
      renderExtractedLeads();
    } catch (e) {
      statusEl.style.color = 'var(--down)';
      statusEl.textContent = 'Extraction failed: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  function renderExtractedLeads() {
    const tbodyEl = document.getElementById('ai-extracted-tbody');
    tbodyEl.innerHTML = extractedLeadsCache.map((lead, idx) => {
      return `
        <tr style="border-bottom: 1px solid var(--card-edge);">
          <td style="padding: 8px 10px;"><input type="text" value="${esc(lead.business)}" style="width: 100%; min-height: 0; padding: 4px;" data-idx="${idx}" data-field="business"></td>
          <td style="padding: 8px 10px;"><input type="text" value="${esc(lead.name)}" style="width: 100%; min-height: 0; padding: 4px;" data-idx="${idx}" data-field="name"></td>
          <td style="padding: 8px 10px;"><input type="text" value="${esc(lead.phone)}" style="width: 100%; min-height: 0; padding: 4px;" data-idx="${idx}" data-field="phone"></td>
          <td style="padding: 8px 10px;"><input type="text" value="${esc(lead.notes)}" style="width: 100%; min-height: 0; padding: 4px;" data-idx="${idx}" data-field="notes"></td>
          <td style="padding: 8px 10px; text-align: center;">
            <button class="btn btn-go" onclick="window.OmniTenderImportRow(${idx})" style="padding: 4px 8px; font-size: 10px; width: auto; min-height: 0; margin: 0; background: var(--up); border: none;">Import</button>
          </td>
        </tr>
      `;
    }).join('');

    // Wire sync listener to inputs to cache edits locally
    tbodyEl.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = e.target.dataset.field;
        extractedLeadsCache[idx][field] = e.target.value;
      });
    });
  }

  // Global helper for single-row import
  window.OmniTenderImportRow = async function (idx) {
    const lead = extractedLeadsCache[idx];
    if (!lead) return;
    try {
      // Post as a single CSV import payload for simplicity
      const csvStr = `Name,Phone,Business,Source,Notes\n"${lead.name}","${lead.phone}","${lead.business}","${lead.source}","${lead.notes}"`;
      await api('/api/leads/import', { method: 'POST', body: { csv: csvStr } });
      toast(`Imported lead: ${lead.business}`);
      
      // Remove from preview list
      extractedLeadsCache.splice(idx, 1);
      if (extractedLeadsCache.length === 0) {
        document.getElementById('ai-extracted-results').style.display = 'none';
        document.getElementById('ai-extract-status').textContent = 'All leads successfully imported!';
      } else {
        renderExtractedLeads();
      }
      loadOverview(); // Reload statistics and list
    } catch (e) {
      toast('Import failed: ' + e.message, true);
    }
  };

  document.getElementById('ai-import-all-btn').addEventListener('click', async () => {
    if (extractedLeadsCache.length === 0) return;
    const btn = document.getElementById('ai-import-all-btn');
    btn.disabled = true;
    try {
      // Build a unified CSV string for batch import
      let csvStr = 'Name,Phone,Business,Source,Notes\n';
      extractedLeadsCache.forEach(lead => {
        csvStr += `"${lead.name}","${lead.phone}","${lead.business}","${lead.source}","${lead.notes}"\n`;
      });
      await api('/api/leads/import', { method: 'POST', body: { csv: csvStr } });
      toast(`Successfully imported ${extractedLeadsCache.length} leads!`);
      extractedLeadsCache = [];
      document.getElementById('ai-extracted-results').style.display = 'none';
      document.getElementById('ai-extract-status').textContent = 'All leads successfully imported!';
      loadOverview();
    } catch (e) {
      toast('Import failed: ' + e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // --- Wire Generation & Tab Controls ---
  document.getElementById('social-generate-btn').addEventListener('click', async () => {
    const brief = document.getElementById('social-brief').value.trim();
    const countVal = parseInt(document.getElementById('social-count').value, 10);
    const checkedBoxes = document.querySelectorAll('#social-platforms-container input:checked');
    const platforms = Array.from(checkedBoxes).map(cb => cb.value);

    const statusEl = document.getElementById('social-gen-status');
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--muted)';
    statusEl.textContent = 'Generating AI drafts... please wait...';

    const btn = document.getElementById('social-generate-btn');
    btn.disabled = true;

    try {
      await api('/api/social/brief', { method: 'POST', body: { brief, count: countVal, platforms } });
      statusEl.style.color = 'var(--up)';
      statusEl.textContent = 'Successfully generated AI drafts!';
      document.getElementById('social-brief').value = '';
      loadSocialDrafts();
    } catch (e) {
      statusEl.style.color = 'var(--down)';
      statusEl.textContent = 'Failed to generate drafts: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Wire filter buttons
  document.querySelectorAll('#v-social .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#v-social .filter-btn').forEach(x => x.classList.remove('on'));
      btn.classList.add('on');
      activeSocialFilter = btn.dataset.filter;
      renderSocialDrafts();
    });
  });

  /* ---- init ---- */
  async function init() {
    applyTheme(getTheme());

    if (getToken()) {
      currentUserRole = sessionStorage.getItem('omni_dash_role') || 'Employee';
      if (isDemoSession()) {
        showDash();
        renderDemoOverview();
        return;
      }
      if (sessionStorage.getItem('omni_dash_pending_setup') === '1') {
        await resumeSetupWizard(sessionStorage.getItem('omni_dash_username') || '');
        return;
      }
      try {
        const r = await fetch(API + '/stats', { headers: authHeaders() });
        if (r.status === 401) throw new Error('expired');
        showDash();
        loadOverview();
        startRefresh();
        resetInactivityTimer();
        return;
      } catch (_) {
        clearToken();
      }
    }
    showUnlock();
  }

  init();

}());
