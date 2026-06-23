// Feedback FAB — a floating "send feedback" button available on every screen.
// Wraps the same anonymous /api/feedback intake as Field Report, adding an
// OPT-IN screenshot: captured client-side (html2canvas, lazy-loaded from CDN
// only when the button is clicked), shown to the member as a preview they can
// remove before sending. Anonymity (Tradition 12): the report stores no
// identity; the warning copy reminds the member the image shows whatever is on
// their screen, so attaching is their explicit choice.
const FeedbackFab = {
  _shot: null,        // captured data URL; kept only until send/close
  _h2c: null,         // html2canvas loader promise
  _tool: "mark",      // "mark" or "redact"

  esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  },

  init() {
    if (document.getElementById("fb-fab")) return;
    const btn = document.createElement("button");
    btn.id = "fb-fab";
    btn.title = "Send feedback";
    btn.setAttribute("aria-label", "Send feedback");
    btn.style.position = "fixed";
    btn.style.bottom = "60px";
    btn.style.right = "16px";
    btn.style.width = "48px";
    btn.style.height = "48px";
    btn.style.borderRadius = "50%";
    btn.style.zIndex = "99990";
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.textContent = "💬";
    btn.addEventListener("click", () => this.open());
    document.body.appendChild(btn);
  },

  // Self-hosted (not a CDN): loading third-party JS into an authenticated
  // recovery app at runtime would expose api.token to a CDN compromise and leak
  // the user's IP to an external host. We vendor html2canvas under /static/ and
  // load it lazily (only on first feedback-button click) to keep page load light.
  _loadH2C() {
    if (window.html2canvas) return Promise.resolve();
    if (this._h2c) return this._h2c;
    this._h2c = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor-html2canvas.min.js";
      s.onload = resolve;
      s.onerror = () => { this._h2c = null; reject(new Error("capture lib failed")); };
      document.head.appendChild(s);
    });
    return this._h2c;
  },

  // Capture BEFORE the modal opens so the shot shows the member's actual screen.
  // Best-effort: any failure just means the form opens without a screenshot.
  async _capture() {
    try {
      await this._loadH2C();
      const canvas = await window.html2canvas(document.body, {
        logging: false,
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        x: window.scrollX,
        y: window.scrollY
      });
      const MAX_W = 1280;  // downscale + JPEG keeps the payload well under the server cap
      let out = canvas;
      if (canvas.width > MAX_W) {
        out = document.createElement("canvas");
        out.width = MAX_W;
        out.height = Math.round(canvas.height * (MAX_W / canvas.width));
        out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
      }
      return out.toDataURL("image/jpeg", 0.75);
    } catch (e) {
      return null;
    }
  },

  async open() {
    if (document.getElementById("fb-modal")) return;
    this._shot = await this._capture();
    this._render();
  },

  close() {
    const m = document.getElementById("fb-modal");
    if (m) m.remove();
    this._shot = null;
  },

  _render() {
    const inp = "fb-input";
    const wrap = document.createElement("div");
    wrap.id = "fb-modal";
    wrap.style.position = "fixed";
    wrap.style.inset = "0";
    wrap.style.zIndex = "99999";
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "center";
    wrap.style.padding = "16px";
    wrap.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    wrap.style.backdropFilter = "blur(4px)";
    wrap.style.webkitBackdropFilter = "blur(4px)";

    wrap.innerHTML =
      '<div class="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto" style="border-radius: 12px; padding: 20px; width: 100%; max-width: 450px; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px;">' +
        '<div class="flex items-center justify-between" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">' +
          '<h4 class="text-sm font-bold text-slate-100 uppercase tracking-wider" style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">💬 Send feedback</h4>' +
          '<button id="fb-close" class="text-slate-500 hover:text-slate-300 text-lg leading-none" aria-label="Close" style="background: none; border: none; color: #5a5a5a; font-size: 20px; cursor: pointer; padding: 0;">✕</button></div>' +
        '<p class="text-xs text-slate-400 leading-relaxed" style="margin: 0; font-size: 12px; line-height: 1.5;">Your report text is filed anonymously — no identity attached.' +
          (this._shot ? ' You can draw on the preview below to redact private data or highlight bugs.' : '') +
          ' Reviewed before any change ships.</p>' +
        (this._shot
          ? '<div id="fb-shot-box" class="space-y-1.5" style="display: flex; flex-direction: column; gap: 8px;">' +
              '<div class="relative group cursor-crosshair" style="position: relative; cursor: crosshair;">' +
                '<canvas id="fb-shot-canvas" class="rounded-lg border border-slate-700 w-full touch-none" style="width: 100%; display: block; border-radius: 8px; max-height: 200px; object-fit: contain;"></canvas>' +
                '<div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition" style="position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; z-index: 10;">' +
                  '<button id="fb-tool-mark" class="bg-cyan-500 text-black text-[10px] font-bold px-2 py-1 rounded border border-cyan-400 shadow-lg" style="font-size: 10px; font-weight: bold; padding: 4px 8px; border-radius: 4px;">Highlight</button>' +
                  '<button id="fb-tool-redact" class="bg-black text-white text-[10px] font-bold px-2 py-1 rounded border border-slate-700 shadow-lg" style="font-size: 10px; font-weight: bold; padding: 4px 8px; border-radius: 4px;">Redact</button>' +
                '</div>' +
              '</div>' +
              '<p class="text-[11px] text-amber-300/90" style="margin: 0; font-size: 11px; color: #fbbf24;">⚠ This screenshot shows your screen. Redact sensitive info before sending.</p>' +
              '<button id="fb-shot-remove" class="text-[11px] text-rose-400 hover:text-rose-300 underline" style="background: none; border: none; font-size: 11px; text-decoration: underline; color: #f87171; cursor: pointer; text-align: left; padding: 0;">Remove screenshot</button></div>'
          : '<p class="text-[11px] text-slate-500" style="margin: 0; font-size: 11px; color: #5a5a5a;">No screenshot attached.</p>') +
        '<label class="text-[11px] text-slate-400 block" style="font-size: 11px; display: block;">Type' +
          '<select id="fb-category" class="' + inp + ' mt-1" style="width: 100%; margin-top: 4px; padding: 8px; font-size: 12px; background: #000; border: 1px solid var(--border); color: var(--ink); border-radius: 6px; outline: none;">' +
            '<option value="bug">🐞 Bug — something is broken</option>' +
            '<option value="improvement">✨ Improvement — make this better</option>' +
            '<option value="question">❓ Question — how does this work?</option>' +
          '</select></label>' +
        '<label class="text-[11px] text-slate-400 block" style="font-size: 11px; display: block;">What happened?' +
          '<textarea id="fb-message" rows="4" maxlength="4000" class="' + inp + ' mt-1" placeholder="Describe the problem or idea — be as specific as you like." style="width: 100%; margin-top: 4px; padding: 8px; font-size: 12px; background: #000; border: 1px solid var(--border); color: var(--ink); border-radius: 6px; outline: none; resize: vertical; min-height: 80px; font-family: inherit;"></textarea></label>' +
        '<button id="fb-send" class="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-medium py-2 rounded-lg text-xs transition" style="width: 100%; padding: 10px; border-radius: 8px; border: none; font-size: 13px; font-weight: bold; cursor: pointer; transition: opacity 0.2s;">Send report</button>' +
        '<p id="fb-status" class="text-[11px] text-center hidden" style="margin: 0; font-size: 11px; text-align: center;"></p>' +
      '</div>';
    document.body.appendChild(wrap);

    const canvas = document.getElementById("fb-shot-canvas");
    if (canvas && this._shot) {
      const ctx = canvas.getContext("2d");
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        this._initDrawing(canvas);
      };
      img.src = this._shot;
    }

    document.getElementById("fb-close").addEventListener("click", () => this.close());
    wrap.addEventListener("click", (e) => { if (e.target === wrap) this.close(); });

    const markBtn = document.getElementById("fb-tool-mark");
    const redactBtn = document.getElementById("fb-tool-redact");
    if (markBtn && redactBtn) {
      const updateBtns = () => {
        markBtn.classList.toggle("ring-2", this._tool === "mark");
        markBtn.classList.toggle("ring-cyan-300", this._tool === "mark");
        redactBtn.classList.toggle("ring-2", this._tool === "redact");
        redactBtn.classList.toggle("ring-white", this._tool === "redact");
      };
      markBtn.addEventListener("click", () => { this._tool = "mark"; updateBtns(); });
      redactBtn.addEventListener("click", () => { this._tool = "redact"; updateBtns(); });
      updateBtns();
    }

    const rm = document.getElementById("fb-shot-remove");
    if (rm) rm.addEventListener("click", () => {
      this._shot = null;
      const box = document.getElementById("fb-shot-box");
      if (box) box.innerHTML = '<p class="text-[11px] text-slate-500">Screenshot removed.</p>';
    });
    document.getElementById("fb-send").addEventListener("click", () => this.submit());
  },

  _initDrawing(canvas) {
    const ctx = canvas.getContext("2d");
    let drawing = false;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    };

    const draw = (e) => {
      if (!drawing) return;
      const pos = getPos(e);
      ctx.lineWidth = Math.max(12, canvas.width / 40);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = this._tool === "redact" ? "#000" : "rgba(34, 211, 238, 0.4)";
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      if (e.cancelable) e.preventDefault();
    };

    const start = (e) => { drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); draw(e); };
    const stop = () => { drawing = false; };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", draw);
    window.addEventListener("mouseup", stop);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", stop);
  },

  _status(msg, kind) {
    const el = document.getElementById("fb-status");
    if (!el) return;
    el.className = "text-[11px] text-center " +
      (kind === "error" ? "text-rose-400" : kind === "ok" ? "text-emerald-400" : "text-slate-400");
    el.textContent = msg;
    el.classList.toggle("hidden", !msg);
  },

  async submit() {
    const category = (document.getElementById("fb-category") || {}).value || "bug";
    const message = ((document.getElementById("fb-message") || {}).value || "").trim();
    if (!message) { this._status("Add a few details first.", "error"); return; }
    
    const canvas = document.getElementById("fb-shot-canvas");
    const shot = canvas ? canvas.toDataURL("image/jpeg", 0.75) : this._shot;

    var apiBase = window.location.hostname === 'omnitender-omniverse.fly.dev' || window.location.port === '3000'
      ? ''
      : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '[::1]'
        ? 'http://' + window.location.hostname + ':3000'
        : 'https://omnitender-omniverse.fly.dev');

    this._status("Sending…", "");
    try {
      const ctx = window.location.href;
      const res = await fetch(apiBase + "/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: category, message: message, context: ctx, screenshot: shot || null })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "HTTP " + res.status);
      }
      const data = await res.json();
      this._status("✓ Report filed — thank you. The away team will look at it.", "ok");
      const m = document.getElementById("fb-message"); if (m) m.value = "";
      // Crisis safety net: distress heard server-side opens Steady Ground right now
      if (data && data.crisis) {
        this.close();
        const sg = document.getElementById("steady-ground-modal");
        if (sg) sg.classList.remove("hidden");
        return;
      }
      setTimeout(() => this.close(), 1500);
    } catch (e) {
      this._status((e && e.message) || "Could not send — try again.", "error");
    }
  },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => FeedbackFab.init());
} else {
  FeedbackFab.init();
}
