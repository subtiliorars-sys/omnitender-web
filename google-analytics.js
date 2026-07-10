/**
 * Google Analytics 4 (gtag) — loads only when site-config.js sets gaMeasurementId.
 * No-op when empty (safe before GA4 property exists).
 */
(function () {
  var cfg = window.OMNI_SITE_CONFIG || {};
  var measurementId = String(cfg.gaMeasurementId || '').trim();
  if (!measurementId) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { send_page_view: true });

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
  document.head.appendChild(s);
})();
