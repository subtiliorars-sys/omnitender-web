# Google Ads conversion snippets — OmniTender

Account / tag: `AW-18309897213`  
Conversion: **Submit lead form** · label `xIWCCP-X-80cEP2365pE`  
`send_to`: `AW-18309897213/xIWCCP-X-80cEP2365pE` · value `1.0` · currency `USD`

---

## Live today (page load)

Successful lead forms redirect to:

`https://omnitender.us/thanks.html?from=…`

That page fires the page-load conversion via `conversion-events.js` (`omniTrackConversion` → `gtag('event', 'conversion', …)`).

Config keys in `site-config.js`:

- `googleAdsId`
- `googleAdsConversionSendTo`
- `googleAdsConversionValue`
- `googleAdsConversionCurrency`

---

## Parked — click / link conversion (not wired)

Google also supplied this **click** snippet. Use it later if we want the conversion on a button/link click instead of (or in addition to) the thanks-page load. Wire by calling `gtag_report_conversion(optionalUrl)` from an `onclick`, and only after confirming we will not double-count with the page-load thanks flow.

```html
<!-- Event snippet for Submit lead form conversion page
In your html page, add the snippet and call gtag_report_conversion when someone clicks on the chosen link or button. -->
<script>
function gtag_report_conversion(url) {
  var callback = function () {
    if (typeof(url) != 'undefined') {
      window.location = url;
    }
  };
  gtag('event', 'conversion', {
      'send_to': 'AW-18309897213/xIWCCP-X-80cEP2365pE',
      'value': 1.0,
      'currency': 'USD',
      'event_callback': callback
  });
  return false;
}
</script>
```

Example wiring (not live):

```html
<a href="thanks.html?from=rate-analysis"
   onclick="return gtag_report_conversion(this.href);">
  Continue
</a>
```

Notes before enabling:

1. Site tag `AW-18309897213` must already be loaded (`google-analytics.js` + `site-config.js`).
2. Prefer **one** primary conversion path (page load **or** click) unless Google Ads is set to count carefully.
3. `event_callback` navigates only after the hit is queued — keep the `return false` on the click handler when using it.

---

*Parked 2026-07-13 — click snippet not installed on production pages.*
