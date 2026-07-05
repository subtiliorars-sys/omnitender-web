/**
 * Meta Pixel — loads only when site-config.js sets metaPixelId.
 * No-op when empty (safe for GitHub Pages before ads go live).
 */
(function () {
  var cfg = window.OMNI_SITE_CONFIG || {};
  var pixelId = String(cfg.metaPixelId || '').trim();
  if (!pixelId) return;

  if (window.fbq) return;

  var n = (window.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  });
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  var f = document.getElementsByTagName('script')[0];
  f.parentNode.insertBefore(s, f);

  fbq('init', pixelId);
  fbq('track', 'PageView');
})();
