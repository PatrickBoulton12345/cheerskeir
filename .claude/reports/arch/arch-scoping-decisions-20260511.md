# Arch: Cheers Keir — Scoping Decisions

**Created by:** Main agent (with Patrick)
**Date:** 2026-05-11
**Status:** Active

---

## Executive Summary

A collaborative parody leaving card for outgoing PM Keir Starmer at **cheerskeir.com**. Visitors open a card, read a curated wall of farewell messages, and sign their own (message + optional display name + email). Email goes to the existing LFG Brevo general newsletter list with the message and name stored as contact attributes for hand-curation. Static HTML + Vercel serverless, matching Patrick's usual stack.

---

## Key Decisions

- **Tone:** Sharp satire — pointed jokes about Starmer's record (U-turns, Bat Tunnel, etc.). Witty, not abusive; picks fights with policy not person. Keeps moderation manageable and avoids defamation risk.
- **Visual metaphor:** Office leaving card. Cover with real Keir photo + "Cheers Keir" headline. Click-to-open animation reveals inside spread: messages on the left page, sign form on the right.
- **Display model:** Curated public selection. Patrick reviews submissions in Brevo and copies the best messages into `messages.json`, git pushes, Vercel auto-deploys. Site reads JSON client-side. Zero infra for moderation; fully version-controlled.
- **Storage:** Brevo contact attributes (`MESSAGE`, `NAME`) on the LFG general newsletter list. Signers join the list and consent to general newsletter follow-up.
- **Form fields:** Message (required, ~280 chars), Display name (optional), Email (required). No location field. No separate newsletter checkbox — the form copy makes clear that signing = joining the list.
- **Anti-spam:** Cloudflare Turnstile (invisible challenge) + Brevo's natural duplicate-email rejection.
- **Post-submit:** Stay on page, form swaps to a thank-you state with a small confetti burst.
- **Signature counter:** Live ticker animation, count fetched from Brevo list size (cached briefly in the count endpoint).
- **Domain & hosting:** cheerskeir.com on Vercel. Repo `PatrickBoulton12345/cheerskeir`.

---

## Context & Background

Patrick has shipped several similar static-HTML + Vercel + Brevo sites (Espresso Newsletter, Eurosnap, LFG Tax Calculator). This is a one-night build using the same proven stack. Sole departure: Cloudflare Turnstile, which is new for this project but a well-trodden integration.

---

## File Structure

```
cheerskeir/
├── index.html               # Single static page with the card
├── messages.json            # Curated, public messages (manually edited)
├── keir.jpg                 # Cover photo (Patrick supplies)
├── api/
│   ├── subscribe.js         # Vercel function: verify Turnstile, create Brevo contact
│   └── count.js             # Vercel function: return list size for ticker (cached)
├── vercel.json              # Build/output config
├── .env.example             # Env var template
├── .gitignore               # Hide .env, node_modules, OS junk
└── README.md                # Setup + deploy steps
```

---

## Environment Variables (Vercel)

| Name | Source | Used by |
|------|--------|---------|
| `BREVO_API_KEY` | LFG Brevo account | `api/subscribe.js`, `api/count.js` |
| `BREVO_LIST_ID` | LFG general newsletter list ID | `api/subscribe.js`, `api/count.js` |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile dashboard | `api/subscribe.js` |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile dashboard | embedded in `index.html` (public) |

The Turnstile **site** key is public by design — fine to inline once Patrick has it, but kept in env for swap convenience.

---

## Brevo Setup Required Before Launch

1. Create two custom contact attributes on the LFG Brevo account:
   - `MESSAGE` (Text, max 255 chars)
   - `NAME` (Text)
2. Confirm `BREVO_LIST_ID` points to the intended general newsletter list.
3. Make sure the LFG account's verified sender / DKIM is set up — not required for contact creation but useful when Patrick eventually emails this list.

---

## Implementation Items

### For Main Agent (this session):
- [x] Scope with Patrick — decisions captured above
- [ ] Build `index.html` with the open-card animation
- [ ] Build `api/subscribe.js` with Turnstile verification + Brevo contact create
- [ ] Build `api/count.js` with short cache
- [ ] Seed `messages.json` with a handful of placeholder messages
- [ ] Add Vercel/env/README scaffolding
- [ ] Verify locally
- [ ] Run /security-review (xss-security-auditor + code-reviewer in parallel)

### For Patrick (before going live):
- [ ] Drop `keir.jpg` into the repo root (cover photo)
- [ ] Add `BREVO_API_KEY`, `BREVO_LIST_ID`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` to Vercel env vars
- [ ] Create `MESSAGE` + `NAME` contact attributes in Brevo
- [ ] Connect cheerskeir.com to Vercel project
- [ ] Replace placeholder `TURNSTILE_SITE_KEY` in index.html (or wire env-injection)

---

## Dependencies

**Depends on:** none (fresh project)
**Blocks:** initial deployment to cheerskeir.com

---

## References

- Espresso Newsletter (`/Users/patrickboulton/Documents/Apps/Espresso Newsletter/`) — same Brevo pattern
- LFG Tax Calculator — ticker animation reference
- Cloudflare Turnstile docs: https://developers.cloudflare.com/turnstile/

---

## Change Log

- **2026-05-11:** Initial creation, scoping complete.
