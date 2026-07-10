/**
 * Shared conversion tracking for Meta Pixel + GA4.
 * Call after a successful lead form submission.
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
  }
  if (typeof window.fbq === 'function') {
    window.fbq('track', 'Lead', payload);
  }
};
