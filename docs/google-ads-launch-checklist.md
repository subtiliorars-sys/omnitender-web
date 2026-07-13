# Google Ads launch checklist — OmniTender

**Goal:** Local NC merchants submit a free rate analysis at `https://omni-tender.com/savings.html`

**Budget:** Start $10/day (~$300/month). Pause if $50 spent with zero form fills.

---

## Before you spend money

1. **GA4 measurement ID** in `site-config.js` → `gaMeasurementId: 'G-XXXXXXXXXX'`
2. **Site deployed** with `google-analytics.js` + `conversion-events.js` on all pages
3. **Test form** on savings.html → you receive alert (OmniVerse webhook)
4. **Payment method** on Google Ads account

---

## Campaign settings (copy exactly)

| Field | Value |
|-------|-------|
| Campaign type | **Search** |
| Goal | **Leads** (or Submit lead forms) |
| Campaign name | `NC Merchants - Rate Analysis` |
| Networks | **Search only** — uncheck Display, uncheck Search partners initially |
| Locations | **Morganton, NC** + **25 mile radius** (add Valdese, Hickory if budget allows) |
| Languages | English |
| Audience segments | Skip for now (keep it simple) |
| Daily budget | **$10.00** |
| Bidding | **Maximize conversions** (after conversion action exists) OR **Maximize clicks** for first 7 days |
| Ad schedule | All day (optional: Mon–Sat 6am–10pm later) |

---

## Keywords (Phrase match — add with quotes)

```
"payment processing morganton"
"credit card processing morganton nc"
"merchant services morganton"
"lower credit card fees"
"square alternative small business"
"restaurant payment processing"
"payment processor near me"
```

**Negative keywords (add early):**
```
jobs
career
salary
free download
course
tutorial
atm
personal
```

---

## Ad group: `Rate Analysis - Local`

### Headlines (pin 1–2 if needed)
```
Free Rate Analysis
Morganton Payment Processing
Lower Your Card Fees
NC Merchant Services
Transparent Pricing
Local Support — Burke County
See What You Really Pay
OmniTender Systems LLC
No Obligation Quote
Cards, Debit, Crypto, EBT
```

### Descriptions
```
Morganton-based merchant services. Free statement review shows what you pay vs transparent pricing.
Independent NC businesses: get a free rate analysis. Processing stays on licensed partner rails.
Tired of hidden batch fees and PCI charges? We'll show you the real numbers — no pressure.
Western NC merchants — call (828) 413-0859 or request analysis online. Local team, not a call center.
```

### Final URL
```
https://omni-tender.com/savings.html
```

### Display path (optional)
```
omni-tender.com / savings
```

---

## Conversion action (in Google Ads)

**Live (page load):** lead forms → `https://omnitender.us/thanks.html`  
Snippets (live + parked click variant): [`google-ads-conversion-snippets.md`](./google-ads-conversion-snippets.md)

1. **Goals → Conversions → New conversion action**
2. Choose **Website**
3. Enter `omnitender.us`
4. Select **Manually coded** or **Google tag** (gtag already on site)
5. Prefer page-load URL `https://omnitender.us/thanks.html` (or event `send_to` already on that page)
6. Count: **One** per click
7. Attribution: **Data-driven** or 30-day click

---

## After launch (week 1)

| Day | Check |
|-----|-------|
| Daily | Any form submissions? Respond within 2 hours |
| Day 3 | Search terms report → add negatives for junk |
| Day 7 | Pause keywords with $20+ spend and zero clicks to savings |
| Day 14 | If CPA > $100 with no leads, drop budget to $5/day and fix landing page |

---

## Human-tech shortcut

If the Google UI is overwhelming: create the campaign with **one ad group, 5 keywords, 3 headlines, 2 descriptions** — launch imperfect, optimize later. A live $10/day campaign beats a perfect draft.

---

*Last updated: 2026-07-13*
