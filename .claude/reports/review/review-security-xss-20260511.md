# Review: Cheers Keir — Security & XSS Audit

**Created by:** xss-security-auditor (subagent)
**Date:** 2026-05-11
**Status:** Active
**Scope:** `index.html`, `api/subscribe.js`, `api/count.js`, `messages.json`, `vercel.json`

---

## Executive Summary

**Verdict: SAFE to launch after addressing three pre-launch checklist items.**

This is one of the most security-conscious LFG projects audited to date. The defensive posture is consistently good: all user-controlled data renders via `textContent`, the server-side input handling is conservative (length caps, control-char stripping, narrow email regex), the CSP is tight (object-src 'none', frame-ancestors 'none', no wildcards), and the Turnstile + Brevo handoff has no bypass paths. There are **no exploitable XSS vulnerabilities**, no server-side injection vectors, no CSRF gaps, and no information disclosure issues.

The remaining items are:
- **0 Critical**
- **0 High**
- **3 Medium** — all defense-in-depth or supply-chain rather than exploitable today
- **5 Low** — minor hardening
- **1 Pre-launch checklist item** that the impl report already flags (real Turnstile sitekey)

**Severity counts (excluding Notable):** 0 / 0 / 3 / 5

---

## Key Findings

| # | Severity | Category | Location | Summary |
|---|----------|----------|----------|---------|
| 1 | Medium | Supply chain | `index.html:28, 31, 34` | No SRI on Google Fonts, Turnstile, canvas-confetti |
| 2 | Medium | CSP / connect-src | `vercel.json:21, 30` | `connect-src` is tighter than required by the page; no impact today but worth a note |
| 3 | Medium | Abuse / Rate-limiting | `api/subscribe.js` (all) | No IP-level rate-limit; Turnstile is the only guard against burst abuse |
| 4 | Low | Hardening | `api/subscribe.js:169` | No Origin/Referer check on POST |
| 5 | Low | Hardening | `vercel.json` | CSP not applied to `/api/*` responses (low value; JSON is `nosniff`) |
| 6 | Low | Hardening | `vercel.json` | Missing `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` |
| 7 | Low | Privacy / data | `api/subscribe.js:115` | `SIGNED_AT` is server time, fine; consider not echoing IP forward |
| 8 | Low | Hardening | `index.html:702` | `data-sitekey` placeholder must be replaced before launch (already on impl TODO list) |

Notable strengths called out in **§ Notably Good** below.

---

## Detailed Findings by Severity

### Critical / High

**None.** No exploitable XSS, no injection, no auth/authz issues, no info disclosure.

---

### Medium

#### M1 — No Subresource Integrity (SRI) on third-party scripts

- **File / Lines:** `index.html:28` (Google Fonts CSS), `index.html:31` (Turnstile), `index.html:34` (canvas-confetti pinned to 1.9.3)
- **Why it matters:** If `cdn.jsdelivr.net` or `challenges.cloudflare.com` is compromised — or, more realistically, if a malicious version of `canvas-confetti@1.9.3` is published (the version is pinned but the hash is not) — the attacker controls a script that runs in your origin with `'unsafe-inline'` permitted. That's full DOM XSS.
- **Today's risk:** Low — those CDNs are well-defended, and Turnstile by design can't have a static hash (the Cloudflare loader fetches further scripts at runtime, which is why SRI is impractical for the Turnstile bootstrap). canvas-confetti 1.9.3 has no known CVEs.
- **What CAN be hashed:** Only canvas-confetti, because it's pinned to a specific version. Turnstile cannot be hashed (dynamic loader). Google Fonts CSS cannot reliably be hashed (the CSS body references hashed font URLs that rotate).
- **Recommended fix:**
  ```html
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"
          integrity="sha384-..."
          crossorigin="anonymous"
          defer></script>
  ```
  Generate the hash with:
  ```sh
  curl -sSL https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js \
    | openssl dgst -sha384 -binary | openssl base64 -A
  ```
  Or use https://www.srihash.org/.

- **CSP backstop:** Even without SRI, the CSP only allows scripts from `'self' https://challenges.cloudflare.com https://cdn.jsdelivr.net` — a CDN compromise of a non-allowlisted host wouldn't help an attacker. So this is genuinely defense-in-depth.

#### M2 — `connect-src` is correct today but lacks future-proofing notes

- **File / Lines:** `vercel.json:21, 30` — `connect-src 'self' https://challenges.cloudflare.com`
- **Current state:** Adequate. The page only fetches `messages.json`, `/api/count`, `/api/subscribe` (all `'self'`), and Turnstile internally hits `challenges.cloudflare.com` (allowlisted).
- **Why flag it:** Two things to know for the next change.
  1. If you ever add an analytics provider (Plausible, Vercel Analytics, etc.) it will be blocked silently. Add the host explicitly.
  2. The current CSP does **not** include `https://api.brevo.com` in `connect-src` — that's correct because Brevo is only called server-side, never from the page. If someone moves a Brevo call into the browser later, the CSP will block it (good failure mode).
- **Recommended fix:** None today. Just a note for future maintainers — keep `connect-src` as narrow as possible. If a future addition needs an external host, prefer adding the exact host, not `https:`.

#### M3 — No IP-based rate limiting on `/api/subscribe`

- **File / Lines:** `api/subscribe.js` (no rate-limiter present)
- **Why it matters:** Turnstile blocks bots, but a determined attacker can solve real Turnstile challenges (Cloudflare-paid challenge farms exist, ~$0.50/1000) and burn through your Brevo quota — or just clutter the list with hostile garbage that Patrick then has to curate around. Brevo's free tier is 300 contacts/day; bursts could realistically hit that.
- **Attack scenario:** A bot loads the page, gets a valid Turnstile token (or buys one), submits a unique random email + offensive message, repeats. Each request individually passes every check.
- **Today's risk:** Medium-low for launch (Turnstile + small site). Becomes Medium-high if the site gets organic press attention.
- **Recommended fix:** Add an IP-level token bucket — Upstash Ratelimit + Vercel KV is the standard pattern, ~30 lines:
  ```js
  // top of subscribe.js
  import { Ratelimit } from '@upstash/ratelimit';
  import { kv } from '@vercel/kv';
  const limiter = new Ratelimit({
    redis: kv,
    limiter: Ratelimit.slidingWindow(5, '1 m'),  // 5 / minute / IP
  });
  // inside handler, after method/content-type guards, before Brevo:
  const ip = clientIp(req) || 'unknown';
  const { success } = await limiter.limit(`subscribe:${ip}`);
  if (!success) return jsonResponse(res, 429, { error: 'Too many requests. Try again in a minute.' });
  ```
  The client already handles `429` correctly (line 891–897 of `index.html`).
- **Alternative:** Acceptable to defer until/unless abuse appears, given Turnstile + Brevo's natural dedup. The 429 client path is already wired.

---

### Low / Hardening

#### L1 — No Origin / Referer check on `/api/subscribe`

- **File / Lines:** `api/subscribe.js:169–183`
- **Why it matters:** Today's CORS posture already blocks cross-origin browser requests (the request requires `Content-Type: application/json`, which makes it a non-simple request needing a preflight, and you don't return any `Access-Control-Allow-*` headers). So real-browser CSRF is not possible. But a `curl`-style attacker can post directly from anywhere — they just hit the Turnstile gate.
- **What an Origin check adds:** Defense-in-depth that costs ~5 lines and stops the cheapest scripted abuse before Turnstile verification (which is a paid Cloudflare call).
- **Recommended fix:**
  ```js
  const ALLOWED_ORIGINS = new Set([
    'https://cheerskeir.com',
    'https://www.cheerskeir.com',
    'http://localhost:3000',  // for vercel dev
  ]);
  // inside handler, before reading body:
  const origin = (req.headers.origin || '').toString();
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(res, 403, { error: 'Forbidden.' });
  }
  ```
  Note: gate localhost behind `process.env.NODE_ENV !== 'production'` if you want to be tidy.
- **Caveat:** Rejecting *missing* Origin (as the snippet does) is the right call — scripted clients can omit it. See past audit lesson on Cambridge Consultation.

#### L2 — CSP not applied to `/api/*` responses

- **File / Lines:** `vercel.json:6–34`
- **Today's state:** The CSP rule has `"source": "/index.html"` and `"source": "/"`. API JSON responses come from `/api/subscribe` and `/api/count` and don't get a CSP. They DO get `X-Content-Type-Options: nosniff` from the global rule.
- **Why it's low:** API responses are `application/json` and `nosniff` — browsers won't execute them as HTML/JS. A CSP doesn't change that.
- **Recommended fix (optional):** Either rely on the global handler block plus per-API-route `Content-Type: application/json` (status quo, fine), or add a default CSP for everything else:
  ```json
  {
    "source": "/(.*)",
    "headers": [
      { "key": "Content-Security-Policy", "value": "default-src 'none'; frame-ancestors 'none'" }
    ]
  }
  ```
  Be careful: this default would also apply to `/index.html` unless you order it before the `/index.html` block, which Vercel does merge but it's worth testing.

#### L3 — Missing COOP / CORP headers

- **File / Lines:** `vercel.json:5–15`
- **What's missing:**
  - `Cross-Origin-Opener-Policy: same-origin` — isolates the browsing context from cross-origin windows (e.g. `window.opener` attacks via popups). You don't use `window.open` so the risk is genuinely nil, but it's free hardening.
  - `Cross-Origin-Resource-Policy: same-site` — prevents other origins from embedding `messages.json` or `/api/count` as a resource.
- **Recommended fix:**
  ```json
  { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
  { "key": "Cross-Origin-Resource-Policy", "value": "same-site" }
  ```
  Add to the global `/(.*)` block.

#### L4 — `clientIp(req)` is forwarded into Turnstile and could be spoofed

- **File / Lines:** `api/subscribe.js:25–31` and the usage at line 204
- **Why flag it:** `x-forwarded-for` is taken as-is, splitting on `,` and taking the first entry — that's correct for behind-Vercel-edge traffic, but if a user puts `x-forwarded-for: 1.2.3.4` in their own request, Vercel *appends* the real client IP rather than replacing the header. So the first value is in fact attacker-controlled. Turnstile's `remoteip` parameter is hint-only (Cloudflare doesn't strictly enforce on it), so the worst case is reduced effectiveness of Turnstile's per-IP heuristics, not auth bypass.
- **Recommended fix:** Prefer `x-real-ip` (Vercel-set, not attacker-spoofable) over `x-forwarded-for`:
  ```js
  function clientIp(req) {
    const real = (req.headers['x-real-ip'] || '').toString().trim();
    if (real) return real;
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      // Vercel appends real IP at the end of XFF; take the last value
      const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
      return parts[parts.length - 1] || undefined;
    }
    return undefined;
  }
  ```
  This matters more if you add rate-limiting per IP (M3), where spoofing the IP would let attackers reset the bucket.

#### L5 — Pre-launch: replace `data-sitekey` placeholder

- **File / Lines:** `index.html:702`
- **Current value:** `data-sitekey="0x4AAAAAAA_REPLACE_ME_SITEKEY"`
- **Impact if shipped as-is:** Turnstile widget will not render; the form will refuse to submit because the client gates on `getTurnstileToken()` returning a value. The form is therefore *fail-closed*, which is good — but signups won't work.
- **Already tracked:** Yes, on the impl-bootstrap TODO list (Patrick TODO #1).

---

## Specific Concerns from the Request — answered

The request listed twelve specific concerns. Here is a one-line verdict on each:

1. **DOM XSS via fetched data → no.** `messages.json` is rendered exclusively through `textContent` (`index.html:796, 800`). `formError.textContent = body.error` is a `textContent` sink — no HTML interpretation. `shareTwitter.href = ...` uses `encodeURIComponent` on a hardcoded share text and a hardcoded URL — no user input flows in. Safe.
2. **Reflected XSS via form → no.** The success path swaps to `.thanks` (server-sent HTML, no echoes); the error path uses `textContent`. The server-side error strings (`api/subscribe.js`) are hardcoded constants, not derived from input. Safe.
3. **HTML injection in dynamic copy → none found.** No template strings interpolated into HTML.
4. **CSP correctness:**
   - `'unsafe-inline'` on `script-src` and `style-src` is necessary for this single-file pattern. Accepted trade-off.
   - All allowlisted hosts are specific (no `https:` wildcard except `img-src 'self' data: https:` which is fine for images).
   - `default-src 'self'` plus restrictive `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` — solid.
   - `connect-src` is tight (see M2).
   - **One blind spot worth knowing:** `img-src 'self' data: https:` allows any HTTPS image. The page only loads `keir.jpg` and Turnstile assets, so this is broader than strictly needed. Trivial DoS-via-tracking-image risk is non-applicable here. Could be tightened to `'self' data: https://challenges.cloudflare.com` if you want a marginal hardening.
5. **Server-side injection at Brevo boundary → no.** Inputs go through `sanitizeText` (strips ASCII control chars except `\t\n\r`), are length-capped (280/60/120), then placed inside an object that is `JSON.stringify`'d. JSON encoding is the correct escaping for JSON. No header injection risk: `api-key` is from `process.env`, not from user input. Safe.
6. **Turnstile bypass paths → none found.**
   - Empty token: rejected client-side (line 879) and server-side (line 199: `!token || token.length > 4096`).
   - Missing token: same, rejected.
   - `process.env.TURNSTILE_SECRET_KEY` missing: `verifyTurnstile` throws `turnstile_secret_missing`, caller catches → 502 returned to client. Cannot bypass.
   - Cloudflare unreachable (5s timeout): `AbortError` propagates to caller's catch → 502 returned. Cannot bypass.
   - Cloudflare returns 200 with `{success: false}`: `!!data.success` → `ok = false` → 400 returned. Cannot bypass.
7. **CSRF → mitigated by content-type requirement + Turnstile.** `Content-Type: application/json` requirement makes the request non-simple (browser preflight required); no CORS allow headers returned, so browser-based cross-origin POSTs are blocked. Scripted (non-browser) CSRF requires solving Turnstile, which is the actual abuse-control layer. Recommend L1 (Origin check) as belt-and-braces.
8. **Open redirects → none.** Share buttons embed `https://twitter.com/intent/tweet` and `https://wa.me/?text=...` URLs with hardcoded shareUrl/shareText — no user-controlled URL ever flows into an `href`.
9. **Prototype pollution / mass assignment → mitigated by destructuring.** `body.message`, `body.name`, `body.email`, `body.turnstileToken` are pulled out by name; nothing iterates `Object.keys(body)` to copy attributes into a target. Body size capped at 16KB (line 57) so a payload bomb (`__proto__: { ... }`) can't even reach the parser via unbounded growth. JSON parser does not interpret `__proto__` keys as prototype writes in modern Node — verified.
10. **Information disclosure → none.** All errors are sanitised at the response boundary. Internal errors logged with `console.error('[subscribe] ...', code)` go to Vercel logs only. The client sees fixed strings like `'Server is misconfigured.'`, never `BREVO_API_KEY`, never stack traces. Brevo response codes never echo to client.
11. **Inline `onerror` on cover IMG → safe.** The `src="keir.jpg"` is hardcoded; no user input flows into the image URL; the `onerror` handler runs only when `keir.jpg` itself fails to load. CSP `'unsafe-inline'` allows inline event handlers, so it works; in a stricter `'strict-dynamic'` CSP this would need replacing.
12. **Curated JSON tampering → safe in this code path.** The `loadMessages()` function (line 776) explicitly uses `createElement` + `textContent` for every field. A bad entry in `messages.json` (typo, hostile HTML, even a script tag) cannot inject anything — it would render as literal text inside a `<span>`. The only way `messages.json` could become a vector is if someone later refactors `loadMessages()` to use `innerHTML`. Worth a code comment to lock the pattern in (already partly present at line 791).

---

## Notably Good

These are the things this codebase gets right, listed so future edits don't regress them:

- **`textContent` everywhere user/fetched data lands in the DOM.** Specifically `index.html:787, 796, 800, 809, 823, 845, 854, 934, 936`. This is the single most-effective XSS mitigation and it's applied consistently.
- **`escapeHTML` utility defined but never used** (line 743). Currently unused because every DOM write went via `textContent` instead — that's actually safer. Keep it around in case someone later needs it for an attribute or HTML context.
- **Server-side input sanitisation is conservative and correct.** Strips ASCII control chars except `\t\n\r` (line 37, verified via byte inspection — the character class is `[\0-\b\v\f\x0e-\x1f\x7f]` even though it renders oddly in the source). Length caps before regex. Lowercases email before validation.
- **Email regex defends against common header-injection chars:** `<>"'`;` excluded (line 23). Good.
- **Body size cap of 16KB on `readJsonBody`** (line 57) — defends against memory-exhaustion / JSON bombs.
- **Method + Content-Type guards happen before body parse** (lines 175–182). Good ordering.
- **Turnstile verification has a 5-second timeout via AbortController** (line 83). Errors are caught and produce a 502, never a silent pass-through.
- **Brevo call has an 8-second timeout** (line 120). Same pattern.
- **Brevo `duplicate_parameter` handled as idempotent success** (line 146–161) — correctly avoids overwriting an existing signer's message. `updateEnabled: false` on the create call belt-and-braces this.
- **`api/count.js` soft-fails to `{ count: 0 }`** when env vars are missing or Brevo is unreachable — page never breaks, no error info leaks.
- **CSP excludes `unsafe-eval`, `'strict-dynamic'`, and any `https:` wildcard for scripts** — every script source is a specific origin. Excellent.
- **`object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`** all set. These are the directives that catch the long-tail of weird browser injection paths.
- **HSTS preload, X-Frame-Options DENY, X-Content-Type-Options nosniff, Permissions-Policy, Referrer-Policy** all in `vercel.json`. Full set of basic headers.
- **All external links use `rel="noopener"`** (lines 724, 725).
- **`autocomplete="name"` and `autocomplete="email"`** on the right fields (lines 685, 690), and importantly `autocomplete` is **not** disabled on credentials — accessibility win.
- **`.gitignore` correctly excludes `.env*`** (line 1–6) — secrets won't be committed by accident.
- **No `eval`, `new Function`, `document.write`, `setTimeout(string, ...)`, `setInterval(string, ...)`** anywhere in `index.html`. All `setTimeout`/`setInterval` calls take function references.
- **No `localStorage` / `sessionStorage` / cookies** — minimal client-side state means minimal attack surface.
- **No `postMessage` listeners** — no cross-origin message channel to misuse.
- **No URL parameter handling** (`location.search`, `URLSearchParams`, hash routing) — entire class of reflected-XSS vectors absent by design.

---

## Recommendations

**Before launch (must-do):**

1. Replace `data-sitekey="0x4AAAAAAA_REPLACE_ME_SITEKEY"` with the real Turnstile site key (`index.html:702`). Already tracked on Patrick's TODO.
2. Set `BREVO_API_KEY`, `BREVO_LIST_ID`, `TURNSTILE_SECRET_KEY` in Vercel env vars. Already tracked.
3. Verify the Brevo `MESSAGE`, `NAME`, `SOURCE`, `SIGNED_AT` attributes are created in the LFG account.

**Before launch (recommended, ~30 minutes):**

4. Add SRI hash to canvas-confetti (M1 fix above).
5. Add Origin/Referer check at the top of `subscribe.js` handler (L1 fix above). Reject missing Origin.
6. Add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-site` to `vercel.json` (L3 fix above).

**Post-launch / if abuse appears:**

7. Add Upstash Ratelimit on `/api/subscribe` (M3 fix above). Client already handles 429 correctly.
8. Switch `clientIp()` to prefer `x-real-ip` (L4 fix above). Important if (7) is added.
9. Consider tightening `img-src` to `'self' data: https://challenges.cloudflare.com` only.

**Maintenance notes:**

10. Add a code comment near `loadMessages()` (around `index.html:791`) explicitly forbidding `innerHTML` for message data — guards against future refactors that might regress message rendering to XSS-prone DOM writes.
11. If you ever add analytics/observability, add the host explicitly to CSP `connect-src` — don't widen to `https:`.

---

## References

- OWASP — Cross-Site Scripting (XSS): https://owasp.org/www-community/attacks/xss/
- OWASP — DOM-based XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- OWASP — CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Cloudflare Turnstile — Server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Brevo — Create contact API: https://developers.brevo.com/reference/createcontact
- MDN — Subresource Integrity: https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
- Vercel — Security headers configuration: https://vercel.com/docs/edge-network/headers
- Upstash Ratelimit (for M3): https://github.com/upstash/ratelimit
- Prior LFG audit lessons (Cambridge Consultation, third pass, 2026-03-31) — Origin check should reject missing Origin; `x-real-ip` preferred over `x-forwarded-for` on Vercel; in-memory rate-limit Maps need cleanup.

---

## Change Log

- **2026-05-11:** Initial security audit complete. Zero Critical/High findings. Three Medium, five Low. Verdict: safe to launch after pre-launch checklist items in `impl-bootstrap-20260511.md` are addressed; recommended ~30-minute hardening pass (SRI, Origin check, COOP/CORP) optional but quick.
