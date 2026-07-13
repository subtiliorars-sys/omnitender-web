/**
 * Google tag (gtag.js) - GA4 and/or Google Ads.
 * Loads only when site-config.js sets gaMeasurementId and/or googleAdsId.
 * No-op when both empty.
 */
(function () {
  var cfg = window.OMNI_SITE_CONFIG || {};
  var measurementId = String(cfg.gaMeasurementId || '').trim();
  var adsId = String(cfg.googleAdsId || '').trim();
  if (!measurementId && !adsId) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());

  if (measurementId) {
    window.gtag('config', measurementId, { send_page_view: true });
  }
  if (adsId) {
    window.gtag('config', adsId);
  }

  var primaryId = measurementId || adsId;
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(primaryId);
  document.head.appendChild(s);
})();
