/**
 * OmniTender Training — VLC-inspired education player (HTML5 + optional Open in VLC)
 */
(function () {
  const SHORTCUTS = {
    playPause: ' ',
    fullscreen: 'f',
    mute: 'm',
    back10: 'j',
    forward10: 'l',
    back5: 'arrowleft',
    forward5: 'arrowright',
    volUp: 'arrowup',
    volDown: 'arrowdown',
  };

  const state = {
    apiBase: '',
    apiToken: '',
    catalog: null,
    lessons: [],
    selectedId: null,
    progress: { completed: {} },
    localFileUrl: null,
  };

  function getDashToken() {
    try { return sessionStorage.getItem('omni_dash_token') || ''; } catch (_) { return ''; }
  }

  function defaultApiBase() {
    const host = window.location.hostname;
    if (host === 'omnitender-omniverse.fly.dev' || window.location.port === '3000') return window.location.origin;
    if (host.endsWith('omnitender.us') || host === 'localhost' || host === '127.0.0.1') {
      return 'https://omnitender-omniverse.fly.dev';
    }
    return 'https://omnitender-omniverse.fly.dev';
  }

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.apiToken}`,
    };
    if (method !== 'GET') headers['X-OV-Console'] = '1';
    const res = await fetch(`${state.apiBase}/api${path}`, {
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

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isTouch() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function getVideo() {
    return document.getElementById('edu-video');
  }

  function formatTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function updateTimeDisplay() {
    const v = getVideo();
    const cur = document.getElementById('edu-time-current');
    const dur = document.getElementById('edu-time-duration');
    if (v && cur) cur.textContent = formatTime(v.currentTime);
    if (v && dur) dur.textContent = formatTime(v.duration);
    const bar = document.getElementById('edu-seek');
    if (v && bar && v.duration) bar.value = (v.currentTime / v.duration) * 100;
  }

  function togglePlay() {
    const v = getVideo();
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function toggleFullscreen() {
    const wrap = document.getElementById('edu-player-wrap');
    if (!wrap) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.requestFullscreen?.().catch(() => {});
  }

  function toggleMute() {
    const v = getVideo();
    if (!v) return;
    v.muted = !v.muted;
    document.getElementById('edu-mute-btn')?.classList.toggle('active', v.muted);
  }

  function seekRel(delta) {
    const v = getVideo();
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  }

  function bindPlayerEvents() {
    const v = getVideo();
    if (!v || v.dataset.bound) return;
    v.dataset.bound = '1';
    v.addEventListener('timeupdate', updateTimeDisplay);
    v.addEventListener('loadedmetadata', updateTimeDisplay);
    v.addEventListener('play', () => document.getElementById('edu-play-btn')?.setAttribute('aria-label', 'Pause'));
    v.addEventListener('pause', () => document.getElementById('edu-play-btn')?.setAttribute('aria-label', 'Play'));
    v.addEventListener('ended', () => markComplete());

    document.getElementById('edu-play-btn')?.addEventListener('click', togglePlay);
    document.getElementById('edu-mute-btn')?.addEventListener('click', toggleMute);
    document.getElementById('edu-fs-btn')?.addEventListener('click', toggleFullscreen);
    document.getElementById('edu-back10')?.addEventListener('click', () => seekRel(-10));
    document.getElementById('edu-fwd10')?.addEventListener('click', () => seekRel(10));
    document.getElementById('edu-seek')?.addEventListener('input', (e) => {
      const video = getVideo();
      if (video && video.duration) video.currentTime = (e.target.value / 100) * video.duration;
    });
    document.getElementById('edu-open-vlc')?.addEventListener('click', openLocalInVlc);
    document.getElementById('edu-pick-local')?.addEventListener('change', onLocalFilePicked);
    document.getElementById('edu-mark-done')?.addEventListener('click', markComplete);
  }

  function onLocalFilePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (state.localFileUrl) URL.revokeObjectURL(state.localFileUrl);
    state.localFileUrl = URL.createObjectURL(file);
    loadVideoSrc(state.localFileUrl, file.name);
    setStatus('Local file loaded — use Open in VLC for full codec support if browser cannot play.');
  }

  function openLocalInVlc() {
    const lesson = state.lessons.find((l) => l.id === state.selectedId);
    const url = lesson?.videoUrl;
    if (url && !url.startsWith('blob:')) {
      window.open('vlc://' + url.replace(/^https?:\/\//, ''));
      setStatus('If VLC did not open, copy the video URL and use Media → Open Network Stream in VLC.');
      return;
    }
    alert(
      'To play in VLC:\n\n' +
      '1. Use "Load local file" for drafts on this PC, or\n' +
      '2. In VLC: Media → Open Network Stream → paste the lesson video URL after upload.\n\n' +
      'Record & transcode: see OmniTender docs/operations/media-vlc-integration.md'
    );
  }

  function loadVideoSrc(src, title) {
    const v = getVideo();
    const empty = document.getElementById('edu-no-video');
    if (!v) return;
    if (src) {
      v.src = src;
      v.classList.remove('hidden');
      empty?.classList.add('hidden');
      document.getElementById('edu-now-playing')?.textContent = title || 'Playing';
    } else {
      v.removeAttribute('src');
      v.classList.add('hidden');
      empty?.classList.remove('hidden');
      document.getElementById('edu-now-playing')?.textContent = title || 'Select a lesson';
    }
    bindPlayerEvents();
  }

  async function markComplete() {
    if (!state.selectedId) return;
    try {
      const data = await api('/education/progress', {
        method: 'POST',
        body: { lessonId: state.selectedId, markComplete: true, lastLessonId: state.selectedId },
      });
      state.progress = data.progress || state.progress;
      renderLessonList();
      setStatus('Lesson marked complete');
    } catch (e) {
      state.progress.completed[state.selectedId] = new Date().toISOString();
      renderLessonList();
      setStatus('Saved locally — ' + e.message);
    }
  }

  async function saveLastLesson(id) {
    try {
      await api('/education/progress', { method: 'POST', body: { lessonId: id, lastLessonId: id } });
    } catch { /* ignore */ }
  }

  function selectLesson(id) {
    state.selectedId = id;
    const lesson = state.lessons.find((l) => l.id === id);
    if (!lesson) return;
    saveLastLesson(id);
    renderLessonList();
    renderLessonDetail(lesson);
    if (isTouch()) {
      document.getElementById('edu-app')?.classList.add('mobile-detail');
    }
  }

  function renderLessonDetail(lesson) {
    document.getElementById('edu-lesson-title').textContent = lesson.title;
    document.getElementById('edu-lesson-desc').textContent = lesson.description || '';
    const tags = document.getElementById('edu-lesson-tags');
    if (tags) {
      tags.innerHTML = (lesson.tags || []).map((t) => `<span class="edu-tag">${esc(t)}</span>`).join('');
    }
    const bot = document.getElementById('edu-bot-hint');
    if (bot) {
      if (lesson.botCommand) bot.textContent = `Also on OmniVerse bot: text "${lesson.botCommand}"`;
      else if (lesson.botLesson) bot.textContent = `Pairs with bot lesson ${lesson.botLesson} — text "train" then "lesson ${lesson.botLesson}"`;
      else bot.textContent = '';
    }

    const instructorEl = document.getElementById('edu-instructor-banner');
    const instr = state.catalog?.instructor || {};
    if (instructorEl) {
      const poster = lesson.posterUrl || instr.posterUrl;
      instructorEl.innerHTML = poster ? `
        <img class="edu-instructor-photo" src="${esc(poster)}" alt="" loading="lazy">
        <div>
          <div class="edu-instructor-name">${esc(instr.name || 'Training host')}</div>
          <div class="edu-instructor-tag">${esc(instr.tagline || '')}</div>
        </div>` : '';
      instructorEl.classList.toggle('hidden', !poster && !instr.name);
    }

    const scriptEl = document.getElementById('edu-lesson-script');
    if (scriptEl) {
      let html = '';
      if (lesson.keyPoints?.length) {
        html += '<h4 class="edu-script-heading">Key points</h4><ul class="edu-key-points">'
          + lesson.keyPoints.map((p) => `<li>${esc(p)}</li>`).join('') + '</ul>';
      }
      if (lesson.script) {
        html += '<h4 class="edu-script-heading">Lesson script</h4><div class="edu-script">'
          + lesson.script.split('\n\n').map((p) => {
            const t = p.trim();
            if (t.startsWith('[') && t.endsWith(']')) {
              return `<p class="edu-script-cue">${esc(t)}</p>`;
            }
            return `<p>${esc(t)}</p>`;
          }).join('') + '</div>';
      }
      scriptEl.innerHTML = html || '<p class="edu-desc">No script yet for this lesson.</p>';
    }

    if (lesson.videoUrl) loadVideoSrc(lesson.videoUrl, lesson.title);
    else {
      loadVideoSrc('', lesson.title);
      if (lesson.posterUrl) {
        const nv = document.getElementById('edu-no-video');
        if (nv && !lesson.videoUrl) {
          nv.innerHTML = `
            <img src="${esc(lesson.posterUrl)}" alt="" class="edu-lesson-poster" loading="lazy">
            <p><strong>Script ready — video recording pending</strong></p>
            <p>Read the script below or record in VLC with Morgan's persona guide.</p>
            <label class="edu-file-label">
              Load local recording (draft)
              <input type="file" id="edu-pick-local" accept="video/*,audio/*" hidden>
            </label>`;
          document.getElementById('edu-pick-local')?.addEventListener('change', onLocalFilePicked);
        }
      }
    }
    if (lesson.posterUrl && lesson.videoUrl) getVideo()?.setAttribute('poster', lesson.posterUrl);
  }

  function renderLessonList() {
    const list = document.getElementById('edu-lesson-list');
    if (!list) return;
    const q = (document.getElementById('edu-search')?.value || '').toLowerCase();
    const filtered = state.lessons.filter((l) =>
      !q || l.title.toLowerCase().includes(q) || (l.sectionTitle || '').toLowerCase().includes(q)
    );
    let lastSection = '';
    list.innerHTML = filtered.map((l) => {
      let head = '';
      if (l.sectionTitle !== lastSection) {
        lastSection = l.sectionTitle;
        head = `<div class="edu-section-label">${esc(l.sectionTitle)}</div>`;
      }
      const done = state.progress.completed?.[l.id];
      const hasVideo = !!l.videoUrl;
      return head + `
        <button type="button" class="edu-lesson-row ${state.selectedId === l.id ? 'active' : ''} ${done ? 'done' : ''}"
                data-id="${esc(l.id)}">
          <span class="edu-lesson-icon">${done ? '✓' : (hasVideo ? '▶' : '📄')}</span>
          <span class="edu-lesson-meta">
            <span class="edu-lesson-name">${esc(l.title)}</span>
            <span class="edu-lesson-dur">${l.durationMin ? l.durationMin + ' min' : ''}${hasVideo ? '' : ' · coming soon'}</span>
          </span>
        </button>`;
    }).join('');

    list.querySelectorAll('.edu-lesson-row').forEach((row) => {
      row.addEventListener('click', () => selectLesson(row.dataset.id));
    });
  }

  function setStatus(msg) {
    const el = document.getElementById('edu-status');
    if (el) el.textContent = msg;
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const section = document.getElementById('v-training');
      if (!section?.classList.contains('on')) return;
      if (e.target.matches('input, textarea, select')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
      if (k === SHORTCUTS.playPause || e.code === 'Space') { togglePlay(); e.preventDefault(); }
      if (k === SHORTCUTS.fullscreen) { toggleFullscreen(); e.preventDefault(); }
      if (k === SHORTCUTS.mute) { toggleMute(); e.preventDefault(); }
      if (k === SHORTCUTS.back10) { seekRel(-10); e.preventDefault(); }
      if (k === SHORTCUTS.forward10) { seekRel(10); e.preventDefault(); }
      if (k === SHORTCUTS.back5) { seekRel(-5); e.preventDefault(); }
      if (k === SHORTCUTS.forward5) { seekRel(5); e.preventDefault(); }
      if (k === SHORTCUTS.volUp) { const v = getVideo(); if (v) v.volume = Math.min(1, v.volume + 0.1); e.preventDefault(); }
      if (k === SHORTCUTS.volDown) { const v = getVideo(); if (v) v.volume = Math.max(0, v.volume - 0.1); e.preventDefault(); }
    });
  }

  function renderShell() {
    const root = document.getElementById('section-training');
    if (!root || root.dataset.rendered) return;
    root.dataset.rendered = '1';
    root.innerHTML = `
      <div class="edu-app" id="edu-app">
        <aside class="edu-sidebar">
          <div class="edu-sidebar-head">
            <h3>Training library</h3>
            <input type="search" id="edu-search" class="edu-search" placeholder="Search lessons…">
          </div>
          <div class="edu-lesson-list" id="edu-lesson-list"></div>
        </aside>
        <div class="edu-main">
          <div class="edu-main-head">
            <button type="button" class="edu-back-btn" id="edu-back-btn" aria-label="Back">←</button>
            <div>
              <h2 id="edu-lesson-title">Select a lesson</h2>
              <p id="edu-bot-hint" class="edu-bot-hint"></p>
            </div>
          </div>
          <div class="edu-player-wrap" id="edu-player-wrap">
            <video id="edu-video" class="edu-video hidden" controlsList="nodownload" playsinline></video>
            <div class="edu-no-video" id="edu-no-video">
              <p><strong>Video coming soon</strong></p>
              <p>Record with VLC → transcode → upload MP4. Until then, read the summary below or use the bot lesson.</p>
              <label class="edu-file-label">
                Load local file (draft)
                <input type="file" id="edu-pick-local" accept="video/*,audio/*" hidden>
              </label>
            </div>
            <div class="edu-controls">
              <button type="button" id="edu-back10" title="Back 10s (J)">⏪ 10</button>
              <button type="button" id="edu-play-btn" aria-label="Play">⏯</button>
              <button type="button" id="edu-fwd10" title="Forward 10s (L)">10 ⏩</button>
              <input type="range" id="edu-seek" min="0" max="100" value="0" aria-label="Seek">
              <span class="edu-time"><span id="edu-time-current">0:00</span> / <span id="edu-time-duration">0:00</span></span>
              <button type="button" id="edu-mute-btn" title="Mute (M)">🔊</button>
              <button type="button" id="edu-fs-btn" title="Fullscreen (F)">⛶</button>
              <button type="button" id="edu-open-vlc" title="Open in VLC">VLC</button>
            </div>
          </div>
          <p id="edu-lesson-desc" class="edu-desc"></p>
          <div id="edu-instructor-banner" class="edu-instructor-banner hidden"></div>
          <div id="edu-lesson-script" class="edu-lesson-script"></div>
          <div id="edu-lesson-tags" class="edu-tags"></div>
          <div class="edu-actions">
            <button type="button" class="mail-btn-sm primary" id="edu-mark-done">Mark lesson complete</button>
          </div>
          <p class="edu-shortcut-hint">Shortcuts: Space play · F fullscreen · M mute · J/L ±10s · ←/→ ±5s · ↑/↓ volume</p>
        </div>
      </div>
      <div class="edu-status-bar" id="edu-status">VLC for authoring; HTML5 player here. Docs: media-vlc-integration.md</div>`;

    document.getElementById('edu-search')?.addEventListener('input', renderLessonList);
    document.getElementById('edu-back-btn')?.addEventListener('click', () => {
      document.getElementById('edu-app')?.classList.remove('mobile-detail');
    });
    bindKeyboard();
  }

  async function loadData() {
    try {
      const cat = await api('/education/catalog');
      state.catalog = cat.catalog;
      state.lessons = cat.lessons || [];
      const prog = await api('/education/progress');
      state.progress = prog.progress || { completed: {} };
    } catch (e) {
      setStatus('Could not load catalog: ' + e.message);
      state.lessons = [];
    }
    renderLessonList();
    const last = state.progress.lastLessonId;
    if (last && state.lessons.some((l) => l.id === last)) selectLesson(last);
    else if (state.lessons.length) selectLesson(state.lessons[0].id);
  }

  window.OmniTenderEducation = {
    init() {
      state.apiBase = defaultApiBase();
      state.apiToken = getDashToken();
      renderShell();
      bindPlayerEvents();
      loadData();
    },
  };
})();
