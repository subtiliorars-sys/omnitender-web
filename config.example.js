/**
 * config.example.js — template for the deploy-time config injection point.
 *
 * This site has no build step (plain static HTML/JS, deployed by
 * `aws s3 sync .` in .github/workflows/deploy.yml). To get the Supabase
 * client its connection details without ever committing a real key, the
 * deploy workflow generates a real `config.js` from this template
 * (substituting the env vars sourced from GitHub Actions secrets) and syncs
 * it to S3 alongside the rest of the site. `config.js` is listed in
 * .gitignore and must NEVER be committed with real values.
 *
 * Only PUBLIC, browser-safe values belong here:
 *   - SUPABASE_URL            — your project's API URL (not secret)
 *   - SUPABASE_PUBLISHABLE_KEY — the anon/publishable key (safe for browsers;
 *                                Supabase Row Level Security is what actually
 *                                protects your data, not key secrecy)
 *
 * NEVER put SUPABASE_SECRET_KEY (the service role / secret key) in this file
 * or in any file served to the browser. That key bypasses Row Level Security
 * and must only ever be used server-side (e.g. inside the Fly.io backend at
 * https://omnitender-omniverse.fly.dev, which already has its own server-only
 * env handling — see that repo, not this one).
 */
window.__OMNITENDER_CONFIG__ = {
  SUPABASE_URL: "__SUPABASE_URL__",
  SUPABASE_PUBLISHABLE_KEY: "__SUPABASE_PUBLISHABLE_KEY__",
};
