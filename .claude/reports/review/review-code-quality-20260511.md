# Code Review: Cheers Keir — Full-Codebase Quality Pass

**Reviewed by:** Code-review agent (claude-sonnet-4-6)
**Date:** 2026-05-11
**Scope:** Correctness, security (OWASP top 10), performance, robustness, maintainability
**Out of scope:** XSS deep dive (parallel agent); single-file HTML architecture (deliberate choice)

---

## Executive Summary

The codebase is well-structured for a ship-fast parody site. Security headers are solid, error handling is careful throughout, Turnstile integration is correct, and all client-side message rendering correctly uses `textContent`. There is one must-fix-before-launch correctness bug — a broken regex in `sanitizeText()` that garbles every stored message — plus a handful of medium-priority hardening items and a few useful polish notes.

---

## Key Findings

| Severity | Area | Issue |
|---|---|---|
| CRITICAL | `api/subscribe.js:37` | `sanitizeText` regex strips spaces and common punctuation, not control chars |
| Should-fix | `api/subscribe.js:26-31` | `x-forwarded-for` taken first; spoofable client IP sent to Turnstile |
| Should-fix | `index.html:34` | canvas-confetti loaded from jsDelivr without SRI hash |
| Should-fix | `api/subscribe.js:149-158` | Best-effort duplicate `add` call has no AbortController timeout |
| Polish | `vercel.json:18-23` | CSP rule for `/index.html` is dead config with `cleanUrls: true` |
| Polish | `index.html:658` | Spread is keyboard-navigable before card opens (opacity:0, no `inert`) |
| Polish | `api/subscribe.js:891` | Client-side 429 handler is dead code — server never emits 429 |
| Polish | `api/count.js:49` | `clearTimeout` is outside `finally`; timer can leak on unexpected throw |

---

## Detailed Findings

---

### CRITICAL — Must Fix Before Launch

#### C-1: `sanitizeText` regex is entirely wrong — strips spaces and punctuation, not control chars

**File:** `api/subscribe.js`, line 37

**The bug:**
```js
return s.replace(/[ --]/g, '').trim();
```

The ESLint disable comment above (line 36) and the function's own docstring both say the intent is to strip ASCII control characters (U+0000–U+001F) while preserving `\t`, `\n`, `\r`. The actual regex does the opposite.

In a JS character class, `/[ --]/` is parsed as a *range*: from `0x20` (space) to `0x2D` (hyphen), inclusive. That covers the 14 printable ASCII characters: space, `!`, `"`, `#`, `$`, `%`, `&`, `'`, `(`, `)`, `*`, `+`, `,`, `-`. It strips none of the actual control characters (U+0000–U+001F), and null bytes pass straight through.

**Concrete impact:**

| Input | After `sanitizeText` | Stored in Brevo |
|---|---|---|
| `"Cheers Keir, good luck!"` | `"CheersKeirgoodluck"` | garbled |
| `"Pete, Brighton"` (name) | `"PeteBrighton"` | garbled |
| `"hello\x00world"` | `"hello\x00world"` | null byte preserved |

Every signature stored in Brevo will have its message and name stripped of all spaces and punctuation. When you review messages for curation in `messages.json`, you will see unreadable strings and be unable to judge message quality. The site is effectively non-functional from a data quality standpoint even if it appears to "work".

**Fix:**
```js
// Strip ASCII control characters (U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F)
// while preserving \t (U+0009), \n (U+000A), \r (U+000D).
function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}
```

---

### Should Fix Soon

#### H-1: Spoofable client IP sent to Turnstile as `remoteip` hint

**File:** `api/subscribe.js`, lines 26–31

```js
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();   // <-- takes first value
  }
  return (req.headers['x-real-ip'] || '').toString().trim() || undefined;
}
```

Vercel sits behind Cloudflare (or its own edge). When a client sends a forged `X-Forwarded-For: 1.2.3.4` header, Cloudflare appends the real IP so the header becomes `1.2.3.4, realIP`. Taking `split(',')[0]` returns the *attacker-controlled* value. The code then passes this to Turnstile's `siteverify` endpoint as `remoteip`.

**Impact:** Low-to-medium. Turnstile's `remoteip` is an *optional hint* for challenge risk scoring; Turnstile does not rely on it for token validity. The cryptographic token itself is what actually matters, and that cannot be spoofed. However, feeding a false IP could in theory allow a bot operator to misrepresent their geography to Cloudflare's scoring model.

**Fix:** Prefer `x-real-ip` (set by Vercel's own proxy, not forwarded from clients) or take the *last* value of `x-forwarded-for` (the upstream-appended real IP):

```js
function clientIp(req) {
  // x-real-ip is set by Vercel's proxy and is not client-spoofable.
  const realIp = (req.headers['x-real-ip'] || '').toString().trim();
  if (realIp) return realIp;
  // Fall back to last value in XFF chain (appended by upstream proxy, not client).
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const parts = xff.split(',');
    return parts[parts.length - 1].trim();
  }
  return undefined;
}
```

---

#### H-2: canvas-confetti loaded from jsDelivr without SRI hash

**File:** `index.html`, line 34

```html
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js" defer></script>
```

The version `@1.9.3` is pinned, which is good — jsDelivr won't serve a different version at this URL. However, if the jsDelivr CDN were compromised or the package registry were poisoned, the browser would execute the tampered script with no integrity check. Given that the CSP already allows `'unsafe-inline'`, an XSS from a CDN compromise would have no further barrier.

**Fix:** Fetch the SRI hash and add it:

```sh
curl -s https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js | openssl dgst -sha384 -binary | openssl base64 -A
```

Then add to the tag:
```html
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"
        integrity="sha384-HASH_HERE"
        crossorigin="anonymous"
        defer></script>
```

Note: SRI is not feasible for the Turnstile script (dynamically served by Cloudflare) or Google Fonts (dynamic per-UA), so canvas-confetti is the only actionable item here.

---

#### H-3: Duplicate-contact "add" call has no abort timeout

**File:** `api/subscribe.js`, lines 149–158

When Brevo returns `duplicate_parameter`, the code makes a best-effort `POST /contacts/lists/{listId}/contacts/add` call to ensure the existing contact is on the list. This inner fetch has no `AbortController` — if Brevo is slow or unresponsive at that moment, the serverless function will hang until Vercel's function timeout kills it (10s default, up to 60s on Pro).

The correctness impact is nil — the `return { created: false, duplicate: true }` on line 160 is reached immediately after the unawaited promise either resolves or rejects, so the response to the client is not delayed. But the function remains alive, burning compute time and potentially incurring Vercel invocation costs.

**Fix:** Add a short-timeout AbortController to the inner call, matching the pattern already used for the primary Brevo call:

```js
const addCtrl = new AbortController();
const addTimer = setTimeout(() => addCtrl.abort(), 4000);
try {
  await fetch(`${BREVO_BASE}/contacts/lists/${listId}/contacts/add`, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ emails: [email] }),
    signal: addCtrl.signal,
  });
} catch (_) { /* best-effort */ }
finally { clearTimeout(addTimer); }
```

---

### Hardening / Polish

#### P-1: CSP rule for `/index.html` is dead config

**File:** `vercel.json`, lines 18–23

With `cleanUrls: true`, Vercel redirects `/index.html` → `/` (301). The CSP header applied to the `/index.html` source pattern therefore never fires in production — any request for `/index.html` is redirected before headers are applied to the response. The `/` rule (lines 26–32) is the effective one.

This is harmless today, but it creates a false sense of security: someone might update the `/` CSP rule and assume the `/index.html` rule is also doing useful work. Remove or consolidate:

```json
// Remove the /index.html block entirely from vercel.json.
// The "/" rule already covers the served content.
```

---

#### P-2: Spread is keyboard-navigable before the card opens

**File:** `index.html`, line 658

The `#spread` section starts with `aria-hidden="true"` and `opacity: 0`. The `aria-hidden` correctly removes it from the accessibility tree. However, `opacity: 0` does not prevent keyboard focus — a keyboard user can Tab into the form fields and Turnstile widget before the card animation has run. A screen reader user who relies on sequential focus order gets a confusing experience.

**Fix:** Add the `inert` attribute to the spread on page load and remove it when the card opens. `inert` prevents focus, pointer events, and AT discovery simultaneously:

```html
<!-- in HTML: -->
<section class="spread" aria-hidden="true" id="spread" inert>

<!-- in JS openCard(): -->
function openCard() {
  if (card.classList.contains('is-open')) return;
  card.classList.add('is-open');
  const spread = $('#spread');
  spread.setAttribute('aria-hidden', 'false');
  spread.removeAttribute('inert');
  setTimeout(() => { $('#message').focus({ preventScroll: true }); }, 1200);
}
```

`inert` has 98%+ browser support as of 2026.

---

#### P-3: Client-side 429 handler is dead code

**File:** `index.html`, lines 891–897

```js
if (res.status === 429) {
  setError('Slow down a moment — please try again shortly.');
  resetTurnstile();
  submitBtn.disabled = false;
  submitBtn.classList.remove('is-loading');
  return;
}
```

Neither `api/subscribe.js` nor `api/count.js` ever returns HTTP 429. Brevo does not return 429 to its API clients via this flow; Vercel's edge rate limiting (if configured) returns 429 but without `Content-Type: application/json` so the `res.json()` fallback path handles it. This branch is unreachable. It's not harmful, but it adds false confidence that rate limiting is in place.

If rate limiting matters later (it should for a viral parody site), the server endpoint needs an actual rate limiter. The client handler can then stay as-is.

---

#### P-4: `clearTimeout` outside `finally` in `count.js`

**File:** `api/count.js`, line 49

```js
try {
  const resp = await fetch(...);
  clearTimeout(timer);   // <-- only reached if fetch doesn't throw
  if (!resp.ok) { ... }
  ...
} catch (err) {
  clearTimeout(timer);   // <-- correctly in catch
  ...
}
```

If `resp.ok` is truthy but `resp.json()` throws an unexpected error (not a JSON parse error, e.g., a stream error), the timer is not cleared in the `try` path. The `finally`-less design means the timer reference leaks until the Node event loop cleans it up at function exit. Low risk in a short-lived serverless function, but inconsistent with the established pattern.

**Fix:**
```js
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 5000);
try {
  const resp = await fetch(..., { signal: ctrl.signal });
  if (!resp.ok) { ... }
  const data = await resp.json();
  ...
  return jsonResponse(res, 200, { count: n }, 'public, s-maxage=60, stale-while-revalidate=300');
} catch (err) {
  console.error('[count] error', err && err.message);
  return jsonResponse(res, 200, { count: 0 }, 'public, s-maxage=30');
} finally {
  clearTimeout(timer);
}
```

---

#### P-5: `messages.json` fetched with `cache: 'no-cache'` on every page load

**File:** `index.html`, line 779

```js
const res = await fetch('messages.json', { cache: 'no-cache' });
```

`no-cache` forces a round-trip to Vercel on every page view to revalidate. For a curated static file that changes at most once a day, this is wasteful at scale. The existing implementation note in the impl report acknowledges this.

**Suggested trade-off:** Switch to `cache: 'default'` (normal HTTP caching). Vercel serves static assets with `Cache-Control: public, max-age=0, must-revalidate` by default, so the browser will still revalidate — but conditional `If-None-Match` / `If-Modified-Since` will often result in 304s rather than full responses. After a push, Vercel invalidates the CDN; users see the new messages within a few minutes at most.

---

#### P-6: `keir.jpg` should have a `rel="preload"` hint when added

**File:** `index.html`, line 647

Currently missing intentionally. When the photo is dropped in before launch, add:

```html
<link rel="preload" as="image" href="keir.jpg" />
```

The cover photo is likely the Largest Contentful Paint candidate on the closed card. Preloading it eliminates the render-blocking font-load discovery delay before the image request starts. Without it, the photo initiates only after the browser parses the `<img>` tag during HTML scanning, which is already deferred past the font preconnect and external script loading.

---

#### P-7: No `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy` header

**File:** `vercel.json`

`COOP: same-origin` isolates this page's browsing context group, preventing cross-origin popups from accessing `window`. `CORP: same-origin` prevents other origins from embedding this page's resources. Neither is required for canvas-confetti or Turnstile. They are lightweight additions that close a class of cross-site info-leak attacks (Spectre-class via SharedArrayBuffer, though that's unlikely on a parody site).

```json
{ "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
{ "key": "Cross-Origin-Resource-Policy", "value": "same-origin" }
```

Add these to the global headers block in `vercel.json`.

---

#### P-8: `updateEnabled: false` semantic is correct but the 204 check is misleading

**File:** `api/subscribe.js`, line 137

```js
if (res.status === 201 || res.status === 204) {
  return { created: true, duplicate: false };
}
```

Brevo's `POST /v3/contacts` with `updateEnabled: false` returns `201 Created` for a new contact and `400` (with `duplicate_parameter`) for an existing one. It does not return `204`. The `204` check is dead code and labels a `204` as `created: true`, which would be semantically wrong (204 = "updated, no body" in REST convention, not "created"). Harmless in practice, but remove to avoid confusion:

```js
if (res.status === 201) {
  return { created: true, duplicate: false };
}
```

---

## What's Already Done Right

- All message wall rendering in `index.html` uses `textContent` and DOM creation — no `innerHTML` path from JSON data. Safe even if `messages.json` contains HTML or script text.
- `escapeHTML()` utility is defined and available in scope even if not currently used on dynamic content.
- Turnstile failure modes are all handled correctly: CDN down → form blocked; placeholder sitekey → form blocked; verify endpoint timeout → explicit 502 (not silent pass-through).
- Brevo API key and Turnstile secret are never exposed to the client. The impl notes, README, and `.gitignore` all correctly keep them server-side.
- Error messages to the client are uniformly safe: no internal error details, no stack traces, no Brevo error codes forwarded. The 200-char truncation of server error text (line 902) is a good defence.
- All `target="_blank"` links have `rel="noopener"` — no tab-napping risk.
- The `messages.json` failure modes are handled gracefully: malformed JSON shows an empty state, not a page error; a missing `messages` key shows the empty state; `textContent` rendering means a bad commit cannot introduce XSS.
- `X-Frame-Options: DENY` + CSP `frame-ancestors: 'none'` double-cover clickjacking (belt-and-braces, both headers needed for broad browser support).
- HSTS is set with `includeSubDomains; preload` and a two-year max-age — correct for a new domain going straight to preload list.
- `BREVO_LIST_ID` is parsed as an integer with `Number.isFinite()` check before use — prevents injection if an env var is misconfigured.
- The `readJsonBody` helper enforces a 16KB payload cap before JSON parsing — prevents memory-exhaustion on large POST bodies.
- `no-store` on subscribe responses prevents intermediate caches from caching user submissions.
- The count endpoint's `soft-fail to 0` design means the ticker never blocks page render.
- `prefers-reduced-motion` disables all transitions and the spinner animation — correct and complete.
- `aria-live="polite"` on the ticker and `role="alert" aria-live="assertive"` on the form error div are semantically correct for their respective urgency levels.
- `debounce()` is defined and available (even though only used on char counter indirectly) — no RAF-abuse on input events.

---

## Recommendations (Priority Order)

1. **Fix `sanitizeText` immediately** (C-1). Every submission before this fix stores garbled data in Brevo. The fix is a one-line regex change.

2. **Add SRI hash to canvas-confetti** (H-2). One `curl | openssl` command to generate; adds meaningful supply-chain hardening with no UX cost.

3. **Fix client IP extraction order** (H-1). Two-line change; eliminates the spoofed-IP Turnstile hint vector.

4. **Add AbortController to duplicate `add` call** (H-3). Copy-paste of the existing pattern; prevents compute waste on Brevo timeouts.

5. **Remove dead `/index.html` CSP rule from `vercel.json`** (P-1). Reduces confusion.

6. **Add `inert` to the spread** (P-2). One attribute in HTML, one `removeAttribute` call in JS; fixes the keyboard pre-card-open issue.

7. **Add `keir.jpg` preload hint** (P-6). Add before launch alongside the photo itself.

8. **Add `COOP` / `CORP` headers** (P-7). Two lines in `vercel.json`.

---

## Notes on Items Evaluated but Not Flagged

- **Double-click race condition:** The submit button is set `disabled = true` synchronously (line 881) before the first `await`, so a second click cannot fire a second submission via the UI in normal browser operation. Not a real race.
- **Turnstile 5-second timeout:** Reasonable. Cloudflare's siteverify typically responds in <200ms. 5s is generous without being reckless.
- **Brevo `duplicate_parameter` detection:** The error code `'duplicate_parameter'` matches Brevo's documented API response. Correct.
- **`SIGNED_AT` ISO format:** `new Date().toISOString()` produces a format Brevo's Date attribute type accepts. Correct.
- **`count.js` caching:** `public, s-maxage=60, stale-while-revalidate=300` is well-formed and semantically correct for a 60s edge-cached read-only endpoint.
- **`cleanUrls: true` + API routing:** Correct. Vercel auto-detects `api/` serverless functions; no explicit routes config needed.
- **Placeholder Turnstile sitekey safety:** With the placeholder, Turnstile never resolves a token, the client-side guard catches it (`if (!token) { setError... }`), and the form is non-submittable. Safe failure mode.

---

## Dependencies

- Depends on: `impl-bootstrap-20260511.md`
- Related: XSS-specific review (parallel agent, not yet merged)

---

## Change Log

- **2026-05-11:** Initial review complete.
