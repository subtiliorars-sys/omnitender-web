# omnitender-web — Wave Registry

Static public site. Branch: `automation/wave-*`.
Verify: `python check_web_links.py` when HTML changes.

## Active queue

### Wave OTW-W1 — Link sweep
**Status:** `done`  
**Branch:** `automation/wave-otw-w1-links`

- [x] Run check_web_links.py; fix broken internal links
- [x] No pricing/rate claims added

**Notes (2026-06-13):** Extended checker with `#fragment` anchor validation; aligned `pos.html` footer and `404.html` recovery links with site nav. Scan: 0 errors.

### Wave OTW-W2 — Apply funnel clarity
**Status:** `active`  
**Branch:** `automation/wave-otw-w2-apply`

- [ ] apply.html + dashboard copy clarity (no legal/rate promises)
- [ ] Cross-link OmniTender docs where referenced

### Wave OTW-W3 — SEO hygiene
**Status:** `pending`  
**Branch:** `automation/wave-otw-w3-seo`

- [ ] Title/meta/robots sane; CNAME unchanged

## Blocked
- Deploy config, secrets, payment copy, processor rate claims — owner queue
