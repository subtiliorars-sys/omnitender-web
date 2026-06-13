# omnitender-web — Wave Registry

Static public site. Branch: `automation/wave-*`.
Verify: `python check_web_links.py` when HTML changes.

## Active queue

### Wave OTW-W1 — Link sweep
**Status:** `active`  
**Branch:** `automation/wave-otw-w1-links`

- [ ] Run check_web_links.py; fix broken internal links
- [ ] No pricing/rate claims added

### Wave OTW-W2 — Apply funnel clarity
**Status:** `pending`  
**Branch:** `automation/wave-otw-w2-apply`

- [ ] apply.html + dashboard copy clarity (no legal/rate promises)
- [ ] Cross-link OmniTender docs where referenced

### Wave OTW-W3 — SEO hygiene
**Status:** `pending`  
**Branch:** `automation/wave-otw-w3-seo`

- [ ] Title/meta/robots sane; CNAME unchanged

## Blocked
- Deploy config, secrets, payment copy, processor rate claims — owner queue
