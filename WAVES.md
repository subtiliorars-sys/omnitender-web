# omnitender-web — Wave Registry

Static public site. Branch: `automation/*`.
Verify: `python check_web_links.py` when HTML changes.

## Active queue

### Wave OTW-W1 — Phase A public site (MVP pages)
**Status:** `done`  
**Branch:** `automation/work-phase-a-home`  
**PR:** https://github.com/subtiliorars-sys/omnitender-web/pull/9

- [x] Home — Phase A wireframe (hero, payment types, why OmniTender, how it works, calculator, CTA)
- [x] Products, Savings, About, Contact pages + nav
- [x] sitemap.xml updated
- [x] No procurement/RFP positioning; no rate guarantees
- [x] `python check_web_links.py` — 0 errors

### Wave OTW-W2 — Apply funnel clarity
**Status:** `active`  
**Branch:** `automation/wave-otw-w2-apply`

### Wave OTW-W3 — SEO hygiene
**Status:** `pending`  
**Branch:** `automation/wave-otw-w3-seo`

- [ ] Title/meta/robots sane; CNAME unchanged

## Blocked
- Deploy config, secrets, payment copy, processor rate claims — owner queue
