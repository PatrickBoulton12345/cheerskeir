# Cheers Keir

A collaborative parody leaving card for the outgoing Prime Minister at **cheerskeir.com**.

Visitors open a card, read curated farewell messages, and sign their own. Submissions land in the LFG Brevo general newsletter list with the message + name stored as contact attributes; the publicly-displayed wall is hand-curated from a versioned `messages.json`.

---

## Stack

- **Static HTML** (`index.html`) — single file, inline CSS + JS, Google Fonts, Cloudflare Turnstile, canvas-confetti.
- **Vercel serverless functions** (`api/subscribe.js`, `api/count.js`) — Node 18+ runtime.
- **Brevo** — contact storage + list count, via the LFG account.
- **Cloudflare Turnstile** — invisible bot check.

No build step. Static files are served as-is; the two API routes run on Vercel.

---

## File layout

```
cheerskeir/
├── index.html         # The page (card UI, form, ticker, confetti)
├── messages.json      # Curated public messages (edit + git push to publish)
├── keir.jpg           # Cover photo (you supply — see TODO)
├── api/
│   ├── subscribe.js   # POST: Turnstile verify + Brevo contact create
│   └── count.js       # GET:  Brevo list size, edge-cached 60s
├── vercel.json        # Security headers + CSP
├── .env.example       # Env var template
├── .gitignore
└── README.md
```

---

## Setup

### 1. Brevo (one-time)
On the LFG Brevo account:

1. **Create the contact attributes** if they don't exist yet (Contacts → Settings → Contact attributes):
   - `MESSAGE` — Text
   - `NAME` — Text
   - `SOURCE` — Text (used to tag these signers as `cheerskeir`)
   - `SIGNED_AT` — Date
2. Note the numeric **list ID** of the general newsletter list (this becomes `BREVO_LIST_ID`).
3. Grab the **API key** (Senders, Domains & dedicated IPs → SMTP & API → API Keys → v3).

### 2. Cloudflare Turnstile (one-time)
1. Cloudflare dashboard → Turnstile → **Add site**.
2. Domain: `cheerskeir.com` (and add `localhost` for dev).
3. Widget type: **Managed**.
4. Copy the **Site key** and **Secret key**.
5. In `index.html`, find the line:
   ```html
   <div class="cf-turnstile" data-sitekey="0x4AAAAAAA_REPLACE_ME_SITEKEY" ...>
   ```
   Replace with your real site key.

### 3. Vercel env vars
In Vercel → Project → Settings → Environment Variables, add for **Production and Preview**:

| Name | Value |
|---|---|
| `BREVO_API_KEY` | (from step 1) |
| `BREVO_LIST_ID` | (from step 1) |
| `TURNSTILE_SECRET_KEY` | (from step 2) |
| `TURNSTILE_SITE_KEY` | (from step 2, optional — currently used only for reference) |

### 4. Cover photo
Drop a press/portrait photo of Keir Starmer named `keir.jpg` in the repo root. The cover styles it to ~78% width with object-fit: cover. Roughly 4:5 portrait works best. If missing, the cover hides the image gracefully.

### 5. Deploy
- Connect the repo to Vercel.
- Add `cheerskeir.com` as a custom domain.
- Push to `main` — Vercel auto-deploys.

---

## How to curate messages

1. Open the LFG Brevo list, filter on `SOURCE = cheerskeir`.
2. Pick the messages you want on the wall.
3. Edit `messages.json` — add an object with `message` and (optional) `name`. Order is preserved.
4. `git add messages.json && git commit -m "publish new messages" && git push`. Vercel deploys; new messages appear within ~30s.

To un-publish, just delete the entry from `messages.json` and push.

---

## Local development

You need the [Vercel CLI](https://vercel.com/docs/cli) to run the API routes locally.

```sh
npm i -g vercel        # one-time
cp .env.example .env.local
# fill in real values in .env.local
vercel dev
```

Then open http://localhost:3000.

Without `vercel dev`, you can still preview the static HTML by serving the folder (`npx serve` or `python3 -m http.server`) — the form will fail at submit because `/api/*` won't exist, but the design / animation works.

---

## Security notes

- All third-party scripts (Turnstile, canvas-confetti, Google Fonts) are CSP-allowlisted in `vercel.json`. Don't add new external scripts without updating the CSP.
- Brevo API key and Turnstile secret are **server-side only** — never inlined in HTML.
- Curated messages from `messages.json` are rendered with `textContent`, not `innerHTML` — safe even if the JSON contains HTML/scripts.
- Submitted text is length-capped and stripped of ASCII control characters server-side before going to Brevo.
- HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and a strict CSP are set in `vercel.json`.

---

## Known TODOs

- [ ] Replace `data-sitekey="0x4AAAAAAA_REPLACE_ME_SITEKEY"` in `index.html` with the real Turnstile site key
- [ ] Drop `keir.jpg` in the repo root
- [ ] Add a real `og.jpg` for social sharing (referenced in `<meta property="og:image">`)
- [ ] Create the Brevo contact attributes (`MESSAGE`, `NAME`, `SOURCE`, `SIGNED_AT`)
- [ ] Connect `cheerskeir.com` to the Vercel project
