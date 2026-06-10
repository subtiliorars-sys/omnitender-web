/* OmniTender admin dashboard — vanilla JS, no frameworks
 * API: https://omnitender-omniverse.fly.dev
 * Token: sessionStorage only, never in URLs
 */

(function () {
  'use strict';

  var API = 'https://omnitender-omniverse.fly.dev';
  var REFRESH_MS = 30000;
  var _refreshTimer = null;

  /* ---- token helpers ---- */
  function getToken() {
    return sessionStorage.getItem('omni_dash_token') || '';
  }
  function setToken(t) {
    sessionStorage.setItem('omni_dash_token', t);
  }
  function clearToken() {
    sessionStorage.removeItem('omni_dash_token');
  }

  /* ---- view switching ---- */
  function showUnlock(errMsg) {
    document.getElementById('dash-view').style.display = 'none';
    document.getElementById('unlock-view').style.display = '';
    var errEl = document.getElementById('unlock-err');
    if (errMsg) {
      errEl.textContent = errMsg;
      errEl.style.display = '';
    } else {
      errEl.style.display = 'none';
    }
    stopRefresh();
  }

  function showDash() {
    document.getElementById('unlock-view').style.display = 'none';
    document.getElementById('dash-view').style.display = '';
  }

  /* ---- fetch helpers ---- */
  function authHeaders() {
    return { 'Authorization': 'Bearer ' + getToken() };
  }

  /* Returns {ok, status, data} — never throws.
   * data is parsed JSON for json responses, raw text for others. */
  function apiFetch(path, isText) {
    return fetch(API + path, { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 401) {
          return { ok: false, status: 401, data: null };
        }
        if (!res.ok) {
          return { ok: false, status: res.status, data: null };
        }
        var parse = isText ? res.text() : res.json();
        return parse.then(function (data) {
          return { ok: true, status: res.status, data: data };
        });
      })
      .catch(function () {
        return { ok: false, status: 0, data: null };
      });
  }

  /* If any request comes back 401, wipe token and return to lock screen. */
  function handle401(result) {
    if (result.status === 401) {
      clearToken();
      stopRefresh();
      showUnlock('Invalid or expired token. Please unlock again.');
      return true;
    }
    return false;
  }

  /* ---- section renderers ---- */

  function renderHealth(result) {
    var el = document.getElementById('health-body');
    if (handle401(result)) return;
    if (!result.ok || !result.data) {
      el.innerHTML = '<span class="pill pill-down">UNREACHABLE</span>';
      return;
    }
    var d = result.data;
    var channels = Array.isArray(d.channels) && d.channels.length
      ? d.channels.join(', ')
      : 'none listed';
    var pill = d.status === 'ok'
      ? '<span class="pill pill-up">UP</span>'
      : '<span class="pill pill-down">DOWN</span>';
    el.innerHTML = pill +
      '<span style="margin-left:10px;font-size:.9rem;color:var(--muted);">' +
      esc(d.bot || '') + ' &mdash; channels: ' + esc(channels) + '</span>';
  }

  function renderTwilioBanner(statsResult) {
    var banner = document.getElementById('twilio-banner');
    if (!statsResult.ok || !statsResult.data) {
      banner.classList.add('hidden');
      return;
    }
    var tw = statsResult.data.twilio || {};
    if (tw.ok === false || tw.code === 'no_credentials') {
      var msg = tw.code === 'no_credentials'
        ? 'Twilio credentials not configured — outbound SMS will not send.'
        : 'Twilio credentials rejected (error ' + esc(String(tw.code || 'unknown')) +
          ') — outbound SMS will not send.';
      banner.textContent = msg;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  function renderStats(result) {
    var el = document.getElementById('stats-body');
    if (handle401(result)) return;
    if (!result.ok || !result.data) {
      el.innerHTML = '<div class="metric-card"><div class="metric-value">—</div><div class="metric-label">Error</div></div>';
      return;
    }
    var c = result.data.counts || {};
    var keys = ['leads', 'onboarding', 'tickets', 'calls'];
    var labels = { leads: 'Leads today', onboarding: 'Onboarding', tickets: 'Tickets', calls: 'Calls' };
    var html = '';
    keys.forEach(function (k) {
      var val = (c[k] !== undefined && c[k] !== null) ? c[k] : '—';
      html += '<div class="metric-card">' +
        '<div class="metric-value">' + esc(String(val)) + '</div>' +
        '<div class="metric-label">' + esc(labels[k] || k) + '</div>' +
        '</div>';
    });
    /* also render any extra keys the API might send */
    Object.keys(c).forEach(function (k) {
      if (keys.indexOf(k) === -1) {
        html += '<div class="metric-card">' +
          '<div class="metric-value">' + esc(String(c[k])) + '</div>' +
          '<div class="metric-label">' + esc(k) + '</div>' +
          '</div>';
      }
    });
    el.innerHTML = html;
    el.className = 'metrics-row';
  }

  function renderQueue(result) {
    var el = document.getElementById('queue-body');
    if (handle401(result)) return;
    if (!result.ok || result.data === null) {
      el.textContent = '— could not load queue —';
      return;
    }
    el.textContent = result.data || '(empty)';
  }

  function renderLeads(result) {
    var el = document.getElementById('leads-body');
    var countEl = document.getElementById('leads-count');
    if (handle401(result)) return;
    if (!result.ok || !result.data) {
      el.innerHTML = '<span class="inline-err">Could not load leads.</span>';
      countEl.textContent = '';
      return;
    }
    var leads = result.data.leads || [];
    countEl.textContent = '(' + (result.data.count || leads.length) + ')';
    if (!leads.length) {
      el.innerHTML = '<span style="color:var(--muted);font-size:.9rem;">No leads yet.</span>';
      return;
    }
    var html = '<ul class="leads-list">';
    leads.forEach(function (l) {
      var name = esc(l.name || '(unnamed)');
      var biz  = l.business ? ' &mdash; ' + esc(l.business) : '';
      var ph   = l.phone    ? ' (' + esc(l.phone) + ')' : '';
      var src  = l.source   ? '<span class="src">[' + esc(l.source) + ']</span>' : '';
      html += '<li>' + name + biz + ph + src + '</li>';
    });
    html += '</ul>';
    el.innerHTML = html;
  }

  function renderPipeline(result) {
    var el = document.getElementById('pipeline-body');
    if (handle401(result)) return;
    if (!result.ok || result.data === null) {
      el.textContent = '— could not load pipeline —';
      return;
    }
    el.textContent = result.data || '(empty)';
  }

  function renderDigest(result) {
    var el = document.getElementById('digest-body');
    if (handle401(result)) return;
    if (!result.ok || result.data === null) {
      el.textContent = '— could not load digest —';
      return;
    }
    el.textContent = result.data || '(empty)';
  }

  function renderRecipients(result) {
    var el = document.getElementById('recip-body');
    var countEl = document.getElementById('recip-count');
    if (handle401(result)) return;
    if (!result.ok || !result.data) {
      el.innerHTML = '<span class="inline-err">Could not load recipients.</span>';
      countEl.textContent = '';
      return;
    }
    var list = result.data.recipients || [];
    countEl.textContent = '(' + (result.data.count || list.length) + ')';
    if (!list.length) {
      el.innerHTML = '<span style="color:var(--muted);font-size:.9rem;">No recipients.</span>';
      return;
    }
    var html = '<ul class="recip-list">';
    list.forEach(function (r) {
      var ch = r.channel
        ? '<span class="recip-ch">' + esc(r.channel) + '</span>'
        : '';
      html += '<li>' + ch + esc(r.name || '(unnamed)') +
        (r.phone ? ' <span style="color:var(--muted);font-size:.8rem;">' + esc(r.phone) + '</span>' : '') +
        '</li>';
    });
    html += '</ul>';
    el.innerHTML = html;
  }

  /* ---- load all sections ---- */
  function loadAll() {
    var token = getToken();
    if (!token) { showUnlock(); return; }

    /* health is unauthenticated */
    apiFetch('/health', false).then(renderHealth);

    /* stats — also drives the twilio banner */
    apiFetch('/stats', false).then(function (r) {
      if (handle401(r)) return;
      renderTwilioBanner(r);
      renderStats(r);
    });

    /* text/plain endpoints */
    apiFetch('/queue', true).then(renderQueue);
    apiFetch('/pipeline', true).then(renderPipeline);
    apiFetch('/digest', true).then(renderDigest);

    /* JSON endpoints */
    apiFetch('/leads', false).then(renderLeads);
    apiFetch('/recipients', false).then(renderRecipients);

    /* timestamp */
    var ts = document.getElementById('last-updated');
    ts.textContent = 'Updated ' + new Date().toLocaleTimeString();
  }

  /* ---- auto-refresh ---- */
  function startRefresh() {
    stopRefresh();
    _refreshTimer = setInterval(loadAll, REFRESH_MS);
  }
  function stopRefresh() {
    if (_refreshTimer !== null) {
      clearInterval(_refreshTimer);
      _refreshTimer = null;
    }
  }

  /* ---- export (fetch+blob, Bearer header required) ---- */
  function doExport() {
    var btn = document.getElementById('export-btn');
    var status = document.getElementById('export-status');
    btn.disabled = true;
    status.textContent = 'Downloading…';
    fetch(API + '/export', { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 401) {
          clearToken();
          stopRefresh();
          showUnlock('Session expired. Please unlock again.');
          return null;
        }
        if (!res.ok) {
          status.textContent = 'Error ' + res.status;
          btn.disabled = false;
          return null;
        }
        return res.blob();
      })
      .then(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'omniverse-export-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        status.textContent = 'Downloaded.';
        btn.disabled = false;
      })
      .catch(function () {
        status.textContent = 'Network error.';
        btn.disabled = false;
      });
  }

  /* ---- XSS escape ---- */
  /* Escapes &<>"'/ — covers text AND single/double-quoted attribute contexts,
   * so future markup that drops a value into an attribute stays safe even though
   * today's sinks are all text-node context. API content (lead/recipient names)
   * is attacker-influenceable via the public forms, so this runs on all of it. */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#47;');
  }

  /* ---- init ---- */
  function init() {
    /* unlock flow */
    document.getElementById('unlock-btn').addEventListener('click', function () {
      var val = document.getElementById('token-input').value.trim();
      if (!val) {
        document.getElementById('unlock-err').textContent = 'Please enter a token.';
        document.getElementById('unlock-err').style.display = '';
        return;
      }
      setToken(val);
      document.getElementById('token-input').value = '';
      showDash();
      loadAll();
      startRefresh();
    });

    /* allow Enter key in token input */
    document.getElementById('token-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        document.getElementById('unlock-btn').click();
      }
    });

    /* lock / logout */
    document.getElementById('lock-btn').addEventListener('click', function () {
      clearToken();
      showUnlock();
    });

    /* manual refresh */
    document.getElementById('refresh-btn').addEventListener('click', function () {
      loadAll();
    });

    /* export */
    document.getElementById('export-btn').addEventListener('click', doExport);

    /* check for existing session token on load */
    if (getToken()) {
      showDash();
      loadAll();
      startRefresh();
    } else {
      showUnlock();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
