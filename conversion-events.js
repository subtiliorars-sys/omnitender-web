/**
 * Shared conversion tracking for Meta Pixel, GA4, and Google Ads.
 * Primary Ads fire: thanks.html page load after a successful lead submit.
 */
window.omniTrackConversion = function (source, extra) {
  var payload = { source: source || 'unknown' };
  if (extra && typeof extra === 'object') {
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
    }
  }

  if (typeof window.gtag === 'function') {
    window.gtag('event', 'generate_lead', payload);

    var cfg = window.OMNI_SITE_CONFIG || {};
    var sendTo = String(cfg.googleAdsConversionSendTo || '').trim();
    if (sendTo) {
      var value = Number(cfg.googleAdsConversionValue);
      if (!isFinite(value)) value = 1.0;
      var currency = String(cfg.googleAdsConversionCurrency || 'USD').trim() || 'USD';
      window.gtag('event', 'conversion', {
        send_to: sendTo,
        value: value,
        currency: currency
      });
    }
  }
  if (typeof window.fbq === 'function') {
    window.fbq('track', 'Lead', payload);
  }
};
