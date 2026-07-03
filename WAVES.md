# omnitender-web — Wave Registry

Static public site. Branch: `automation/*`.
Verify: `python check_web_links.py` when HTML changes.

## Active queue

### Wave OTW-W13 — About page FAQ

**Branch:** `automation/wave-otw-w13-about-faq` _(next pickup)_

- [ ] Add "Before you reach out" FAQ to `about.html` (processor role, funds, location, getting started)
- [ ] Verify: `python3 check_web_links.py`

## Completed

### Wave OTW-W12 — Legal/404 nav parity + CSS cache bust ✅

**Branch:** `cursor/site-wave-processing-4d66` · PR #29 (2026-07-03)

- [x] Align privacy, terms, and 404 topnav with site-wide nav
- [x] Expand 404 helpful links (savings, contact)
- [x] CSS cache-bust aligned with main (`style.css?v=9` on public pages)
- [x] Merged with main passkey dashboard login (no duplicate PIN-only UI)

### Wave OTW-W12 — Hero trust strip + tel CTA prominence ✅

**Branch:** `automation/wave-otw-w12-trust-strip` · PR #30 (2026-06-28)

- [x] Visible education-only trust strip in home hero (no fake stats, no rate promises)
- [x] Prominent `tel:` CTA on mobile and desktop
- [x] `python check_web_links.py` passes

### Wave OTW-W11 — Tester hub QA link + broken link fix ✅

**Branch:** `automation/wave-otw-w11-tester-hub` · merged into main (2026-06-25 verified)

- [x] Remove broken `pa/index.html` link (internal ops page removed)
- [x] Link GitHub QA smoke-report issue template from `test.html`
- [x] Add `merchants-nc.html` to tester hub core pages
### Wave OTW-W10 — Post-apply success next steps ✅
**Branch:** `automation/wave-otw-w10-apply-success` · merged PR #23 (2026-06-20)

### Wave OTW-W9 — NC local merchants landing page ✅
**Branch:** `automation/wave-otw-w9-nc-merchants` · merged PR #22 (2026-06-17)

### Wave OTW-W8 — Form UX polish (focus + aria-live) ✅
**Branch:** `automation/wave-otw-w8-form-ux` · merged PR #21 (2026-06-15)

### Wave OTW-W7 — Post-submit funnel nudge (REV-01) ✅
**Branch:** `automation/wave-otw-w7-funnel-nudge` · merged PR #20 (2026-06-14)

### Wave OTW-W6 — QA issue template (smoke reports) ✅
**Branch:** `automation/wave-otw-w6-qa-template` · merged PR #17 (2026-06-14)
- QA template link wired from `test.html` in OTW-W11

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
