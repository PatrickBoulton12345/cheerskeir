# Report Registry

**Last Updated:** 2026-05-11 (security review added)

> **Purpose:** Central index. Check here first before starting new work.

---

## Reports by Category

### Arch
| Report | Date | Status | Summary |
|--------|------|--------|---------|
| [arch-scoping-decisions-20260511.md](arch/arch-scoping-decisions-20260511.md) | 2026-05-11 | Active | Initial scoping decisions for the Cheers Keir parody leaving-card site: sharp-satire tone, office-leaving-card visual, click-to-open animation, real Keir photo cover, curated public selection via messages.json, Brevo (LFG account) for storage + newsletter, Cloudflare Turnstile + email dedupe for anti-spam, confetti success state. |

### Impl
| Report | Date | Status | Summary |
|--------|------|--------|---------|
| [impl-bootstrap-20260511.md](impl/impl-bootstrap-20260511.md) | 2026-05-11 | Active | Initial build of the static index.html (click-to-open card, post-it message wall, sign form, ticker, confetti), `api/subscribe.js` (Turnstile verify + Brevo contact create with MESSAGE/NAME/SOURCE/SIGNED_AT attributes, duplicates handled as idempotent success), `api/count.js` (edge-cached list-size endpoint with soft-fail), seed `messages.json`, strict CSP + security headers in `vercel.json`. Static checks green; UI verified twice via ux-ui-designer (two ship-blockers found and fixed); security pass complete with both Medium and Low hardening applied (SRI on canvas-confetti, Origin allowlist, x-real-ip preference, AbortController on duplicate Brevo call, inert on spread, COOP/CORP). |

### Review
| Report | Date | Status | Summary |
|--------|------|--------|---------|
| [review-security-xss-20260511.md](review/review-security-xss-20260511.md) | 2026-05-11 | Active | XSS / injection / CSP / CSRF / CORS / supply-chain audit of `index.html`, `api/subscribe.js`, `api/count.js`, `messages.json`, `vercel.json`. Verdict: safe to launch. 0 Critical, 0 High, 3 Medium (SRI on canvas-confetti, no rate-limit, connect-src note), 5 Low (Origin check, COOP/CORP, x-real-ip, CSP on /api, sitekey placeholder). Notable strengths: textContent throughout, conservative server sanitisation, tight CSP, no eval/innerHTML/postMessage/localStorage, all share URLs hardcoded + encodeURIComponent. |
| [review-code-quality-20260511.md](review/review-code-quality-20260511.md) | 2026-05-11 | Active | Broader code-quality + OWASP pass paralleling the XSS audit. 1 "Critical" (sanitize regex) was a tool-rendering false positive — verified the actual bytes in the file are correct and added behavioural tests; rewrote the regex with `\xNN` escapes to prevent re-occurrence. 3 Should-fix (x-real-ip preference, SRI on canvas-confetti, AbortController on duplicate-add Brevo call) all applied. 8 polish items (dead CSP rule, inert on spread, COOP/CORP, etc.) applied where cheap; rate-limit + preload + cache tweaks deliberately deferred. |

### Analysis
| Report | Date | Status | Summary |
|--------|------|--------|---------|

### Handoff
| Report | Date | Status | Summary |
|--------|------|--------|---------|

### Archive
| Report | Date | Status | Summary |
|--------|------|--------|---------|
