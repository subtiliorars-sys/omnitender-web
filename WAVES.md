# omnitender-web — Wave Registry

Static public site. Branch: `automation/*`.
Verify: `python check_web_links.py` when HTML changes.

## Active queue

### Wave OTW-W9 — NC local merchants landing page
**Status:** `pending`  
**Branch:** `automation/wave-otw-w9-nc-merchants`

- [ ] `merchants-nc.html` — Burke County / Western NC positioning (no fake stats)
- [ ] Sitemap + nav link

### Wave OTW-W10 — Post-apply success next steps
**Status:** `pending`  
**Branch:** `automation/wave-otw-w10-apply-success`

- [ ] Apply success panel: what happens next + rate-analysis cross-link

## In review

### Wave OTW-W8 — Form UX polish (focus + aria-live)
**Status:** `in_review`  
**Branch:** `automation/wave-otw-w8-form-ux`

- [x] Focus first invalid field on submit (`savings.html`, `apply.html`)
- [x] `aria-live` region for form errors

### Wave OTW-W6 — QA issue template (smoke reports)
**Status:** `in_review`  
**Branch:** `automation/wave-otw-w6-qa-template`

- [x] GitHub issue template for website smoke reports
- [ ] Link from `test.html` after merge

### Wave OTW-W7 — Post-submit funnel nudge (REV-01)
**Status:** `in_review`  
**Branch:** `automation/wave-otw-w7-funnel-nudge`

- [x] Rate-analysis success → apply CTA with obligation copy
- [x] Home hero dual CTA (analysis + apply) + tel prominence

## Completed

### Wave OTW-W6 — Products page FAQ ✅
**Branch:** `automation/wave-otw-w6-products-faq` · merged PR #15 (2026-06-14)

### Wave OTW-W5 — Savings page FAQ ✅
**Branch:** `automation/wave-otw-w5-savings-faq` · merged PR #14 (2026-06-14)

### Wave OTW-W4 — Contact FAQ ✅
**Branch:** `automation/wave-otw-w4-contact-faq` · merged 2026-06-13

### Wave OTW-W1 — Phase A public site (MVP pages) ✅
**PR:** https://github.com/subtiliorars-sys/omnitender-web/pull/9

### Wave OTW-W2 — Apply funnel clarity ✅
**PR:** https://github.com/subtiliorars-sys/omnitender-web/pull/10

### Wave OTW-W3 — SEO hygiene ✅
**PR:** https://github.com/subtiliorars-sys/omnitender-web/pull/11

## Blocked
- Deploy config, secrets, payment copy, processor rate claims — owner queue

## Revenue sprint
Fleet registry: AgentCorps `fleet/revenue-waves-2026-06.md`
