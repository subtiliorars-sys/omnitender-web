/**
 * supabaseClient.js — browser-safe Supabase client for the static
 * omnitender-web marketing/dashboard site.
 *
 * This repo has no bundler/build step, so we load the Supabase JS SDK from
 * the CDN and initialize it here using config values that are injected at
 * DEPLOY TIME, not baked into source control:
 *
 *   1. The deploy workflow (.github/workflows/deploy.yml) renders
 *      config.example.js -> config.js, substituting SUPABASE_URL and
 *      SUPABASE_PUBLISHABLE_KEY from GitHub Actions secrets.
 *   2. config.js sets window.__OMNITENDER_CONFIG__ and is synced to S3 with
 *      the rest of the static site. It is gitignored — never committed.
 *   3. This file reads that global and builds the client.
 *
 * SECURITY — read before touching this file:
 *   - Only SUPABASE_URL and the PUBLISHABLE (anon) key may ever appear here
 *     or in config.js. Both are safe to ship to a browser; Supabase Row
 *     Level Security policies are the actual access control, not secrecy
 *     of these values.
 *   - SUPABASE_SECRET_KEY (service role key) must NEVER be referenced,
 *     embedded, fetched, or logged in this file or any file served to the
 *     browser. It belongs only in a trusted server process (the Fly.io
 *     backend at omnitender-omniverse, not this static site).
 *   - Do not add a server-side admin client to this repo — this repo only
 *     ships browser-served files.
 *
 * Usage (in an HTML page, after the CDN script and config.js):
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="config.js"></script>
 *   <script src="supabaseClient.js"></script>
 *   <script>
 *     // window.supabaseClient is now available
 *     const { data, error } = await window.supabaseClient.from('table').select();
 *   </script>
 */
(function () {
  var cfg = window.__OMNITENDER_CONFIG__;

  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    console.error(
      "[supabaseClient] Missing window.__OMNITENDER_CONFIG__. " +
        "Make sure config.js is generated and loaded before supabaseClient.js. " +
        "See config.example.js for the template; real values come from the " +
        "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY deploy-time secrets, never from source."
    );
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error(
      "[supabaseClient] @supabase/supabase-js was not found on window.supabase. " +
        "Make sure the CDN script tag is loaded before this file: " +
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
    );
    return;
  }

  // Browser-safe client only. Do NOT add a secret-key/service-role client here.
  window.supabaseClient = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_PUBLISHABLE_KEY
  );
})();
