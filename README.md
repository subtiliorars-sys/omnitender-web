# omnitender-web

OmniTender's public marketing site — a small, dependency-free static site:

| Page | Purpose |
|------|---------|
| `index.html` | SMS text-alert opt-in (consent form for the OmniTender Alerts program) |
| `apply.html` | Merchant application (credit, debit, digital/crypto, EBT/SNAP) |
| `privacy.html` | Privacy Policy for the SMS program |
| `terms.html` | SMS Terms & Conditions |
| `404.html` | Branded not-found page (see deploy note below to wire it up) |
| `style.css` | Single shared stylesheet (brand: vivid **orange `#FF6600`** on black) |
| `robots.txt`, `sitemap.xml` | SEO crawl hints |

Every page carries a shared accessible top nav (`Text alerts` · `Merchant
application`) with `aria-current="page"` on the active page, so either audience
can reach the other.

No build step, no framework, no external assets — just HTML + one CSS file. The
favicon is an inline SVG data URI, so there are no binary files to manage.

## Forms

Both forms POST JSON to the **OmniVerse** backend (`omnitender-omniverse.fly.dev`),
which logs the lead and alerts the team:

- `index.html` → `POST /lead-webhook` — `{ name, phone, consent, source, notes }`
- `apply.html` → `POST /apply` — `{ business, name, phone, notes }`

Forms are progressively enhanced with JavaScript: inline validation, a disabled
"Submitting…" state, an accessible success panel (`role="status"`), and a failure
panel (`role="alert"`) that surfaces the support email/phone if the request fails —
the user is never left without a next step. (Submission requires JavaScript; there
is no server-side form fallback because the backend expects JSON.)

## Accessibility

- Skip-to-content link, single descriptive `<h1>` per page, landmark `<main>`/`<nav>`.
- Visible `:focus-visible` rings; focus moves to the result panel after submit.
- `aria-required` / `aria-invalid` / `aria-describedby` wired to inline error text.
- AA-contrast palette on the dark theme; `prefers-reduced-motion` respected;
  comfortable (≥44px) tap targets.

## SEO

Per-page `<title>` + meta description, canonical URL, Open Graph + Twitter cards,
`theme-color`, an Organization JSON-LD block on the homepage, plus `robots.txt`
and `sitemap.xml`.

> **Canonical/sitemap URLs** point at the current live CloudFront domain
> (`d2htga59lk9fv.cloudfront.net`). If a custom domain (e.g. `omni-tender.com`) is
> later attached, update the `<link rel="canonical">`, `og:url`, `sitemap.xml`, and
> `robots.txt` URLs to match.

## Performance & hardening

- `color-scheme: dark` (meta + CSS) so native form controls, autofill, the caret,
  and scrollbars render dark instead of flashing light over the black theme.
- `preconnect` + `dns-prefetch` to the lead backend on the form pages, so the
  TLS handshake is pre-warmed before the user submits.
- `Referrer-Policy: strict-origin-when-cross-origin` (meta) on every page.

> Full security headers (CSP, HSTS, frame-ancestors, etc.) and form spam
> protection belong server-side (CloudFront Response Headers Policy + backend
> validation) and are tracked in the founder queue, not set as meta tags here.

## Local preview

It's a static site — open `index.html` directly, or serve the folder:

```sh
python -m http.server 8000   # then visit http://localhost:8000
```

## Deployment

The site is hosted on AWS: a **private S3 bucket** fronted by **CloudFront**
(Origin Access Control), provisioned by `~/aws-infra/modules/static_site`.

- Bucket: `subtiliorars-omnitender-web-380592535426`
- Distribution: `E2MXZUPT4Y6JYE` → `https://d2htga59lk9fv.cloudfront.net`
- State: `~/aws-infra/.state/static_site-omnitender-web.json`

**To publish content updates in place** (recommended — keeps the same distribution
and URL), sync the site files to the bucket and invalidate the CloudFront cache:

```sh
aws s3 sync . s3://subtiliorars-omnitender-web-380592535426 \
  --exclude ".*" --exclude "*/.*" \
  --exclude "README.md" --exclude "LICENSE" --exclude "CLAUDE.md"
aws cloudfront create-invalidation --distribution-id E2MXZUPT4Y6JYE --paths "/*"
```

> ⚠️ Note: `deploy_static_site.py` is the **initial provisioner** — it creates a
> *new* CloudFront distribution and OAC on every run and overwrites the saved
> state. Use it to stand the site up the first time, not to push routine content
> updates (that would orphan the existing distribution and change the live URL).
> For updates, prefer the `s3 sync` + invalidation above.

**404 page:** `404.html` ships in the repo but only renders for bad URLs once
the CloudFront distribution has a **Custom Error Response** mapping 403/404 →
`/404.html` (response code 404). That's a distribution config change (earmarked
for the founder), not a content change.

## License

See [LICENSE](LICENSE).
