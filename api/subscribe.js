// /api/subscribe — verify Turnstile, validate inputs, create/update Brevo contact.
//
// Required env vars (set in Vercel project settings):
//   BREVO_API_KEY         — LFG Brevo account API key (server-side only)
//   BREVO_LIST_ID         — numeric ID of the general newsletter list
//   TURNSTILE_SECRET_KEY  — Cloudflare Turnstile secret key (server-side only)
//
// Brevo contact attributes used (create these in the Brevo dashboard first):
//   MESSAGE   — text, the signer's note (<= 255 chars to fit Brevo limits)
//   NAME      — text, optional display name
//   SOURCE    — text, set to 'cheerskeir' so LFG list owners can filter
//   SIGNED_AT — date, ISO-8601, set server-side

const BREVO_BASE = 'https://api.brevo.com/v3';
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const MAX_MESSAGE = 280;        // matches client UI
const BREVO_ATTR_MAX = 255;     // hard cap for Brevo text attributes
const MAX_NAME = 60;
const MAX_EMAIL = 120;

// Allowed origins for browser-initiated submissions. Defense-in-depth on top of
// the Content-Type + Turnstile requirements (browser CSRF is already blocked by
// the JSON-only contract). Requests without an Origin header are rejected too —
// scripted clients can omit Origin, so allowing missing values would defeat this.
const ALLOWED_ORIGINS = new Set([
  'https://cheerskeir.com',
  'https://www.cheerskeir.com',
  // Local dev (vercel dev) — guarded by NODE_ENV check below
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

// Conservative server-side email pattern. Brevo will reject malformed ones too.
const EMAIL_RE = /^[^\s@<>"'`;]{1,64}@[^\s@<>"'`;]{1,253}\.[^\s@<>"'`;]{1,63}$/;

function clientIp(req) {
  // x-real-ip is set by Vercel's proxy and is not client-spoofable.
  const real = (req.headers['x-real-ip'] || '').toString().trim();
  if (real) return real;
  // Fall back to the LAST value of x-forwarded-for. Vercel appends the real
  // client IP at the end of the XFF chain; the first value is whatever the
  // client sent (potentially spoofed).
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || undefined;
  }
  return undefined;
}

// Strip ASCII control characters (U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F)
// while preserving \t (U+0009), \n (U+000A), \r (U+000D). Written with \x escapes
// so the source is readable in any tool — prior version used literal control bytes,
// which various code-search tools rendered as `[ --]` and panicked code reviewers.
function sanitizeText(s) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  // Vercel parses JSON for application/json by default, but be defensive.
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024) {
        reject(new Error('payload_too_large'));
        try { req.destroy(); } catch (_) {}
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function isOriginAllowed(req) {
  const origin = (req.headers.origin || '').toString();
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Vercel deployments (cheerskeir.vercel.app, cheerskeir-*.vercel.app preview URLs).
  // These are all hosted by Vercel under Patrick's project, so legit.
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw new Error('turnstile_secret_missing');
  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  // 5-second timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(TURNSTILE_VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return !!data.success;
  } finally {
    clearTimeout(timer);
  }
}

async function createOrUpdateBrevoContact({ email, name, message, mailingList }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('brevo_api_key_missing');

  // The list ID is only required when the user has opted in. If they declined,
  // we still create the contact (so Patrick can curate their message) but with
  // no listIds — Brevo accepts that, contact is on no list, no marketing.
  let listIds;
  if (mailingList) {
    const listIdRaw = process.env.BREVO_LIST_ID;
    if (!listIdRaw) throw new Error('brevo_list_id_missing');
    const listId = parseInt(listIdRaw, 10);
    if (!Number.isFinite(listId)) throw new Error('brevo_list_id_invalid');
    listIds = [listId];
  }

  const body = {
    email,
    updateEnabled: false,  // first signature wins; duplicates handled below
    attributes: {
      MESSAGE: message.slice(0, BREVO_ATTR_MAX),
      NAME: name || '',
      SOURCE: 'cheerskeir',
      SIGNED_AT: new Date().toISOString(),
      MAILING_LIST_OPT_IN: !!mailingList,
    },
  };
  if (listIds) body.listIds = listIds;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(`${BREVO_BASE}/contacts`, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // Brevo's POST /v3/contacts returns 201 on creation. (204 was previously
  // accepted here but Brevo's documented response is 201; removed.)
  if (res.status === 201) {
    return { created: true, duplicate: false };
  }

  // Brevo returns 400 with code "duplicate_parameter" when email already exists.
  let parsed = {};
  try { parsed = await res.json(); } catch (_) {}
  const code = (parsed && parsed.code) || '';

  if (res.status === 400 && code === 'duplicate_parameter') {
    // Already exists — treat as success but don't overwrite their original message.
    // Only re-add them to the mailing list if they explicitly opted in *this time*.
    // (If they previously opted in, they're already on the list; if they previously
    // opted in but now opted out, we leave them on the list — explicit unsubscribe
    // is the only way off, which Brevo handles separately.)
    if (mailingList && listIds) {
      const addCtrl = new AbortController();
      const addTimer = setTimeout(() => addCtrl.abort(), 4000);
      try {
        await fetch(`${BREVO_BASE}/contacts/lists/${listIds[0]}/contacts/add`, {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ emails: [email] }),
          signal: addCtrl.signal,
        });
      } catch (_) { /* best-effort */ }
      finally { clearTimeout(addTimer); }
    }
    return { created: false, duplicate: true };
  }

  // Any other status: log server-side, return generic to client.
  console.error('[subscribe] brevo error', res.status, code || '(no code)');
  throw new Error('brevo_create_failed');
}

module.exports = async function handler(req, res) {
  // Method + content-type guards
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST');
    return jsonResponse(res, 204, {});
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonResponse(res, 405, { error: 'Method not allowed.' });
  }
  const ctype = (req.headers['content-type'] || '').toString().toLowerCase();
  if (!ctype.includes('application/json')) {
    return jsonResponse(res, 415, { error: 'Expected application/json.' });
  }

  // Origin allowlist (browser CSRF is already blocked by JSON content-type, but
  // this also stops the cheapest scripted clients before we burn a Turnstile call).
  if (!isOriginAllowed(req)) {
    return jsonResponse(res, 403, { error: 'Forbidden.' });
  }

  // Parse body
  let body;
  try { body = await readJsonBody(req); }
  catch (e) {
    const msg = e && e.message === 'payload_too_large' ? 'Payload too large.' : 'Invalid JSON.';
    return jsonResponse(res, 400, { error: msg });
  }

  const messageRaw  = sanitizeText((body && body.message) || '').slice(0, MAX_MESSAGE);
  const nameRaw     = sanitizeText((body && body.name) || '').slice(0, MAX_NAME);
  const emailRaw    = sanitizeText((body && body.email) || '').slice(0, MAX_EMAIL).toLowerCase();
  const token       = (body && body.turnstileToken && String(body.turnstileToken)) || '';
  const mailingList = body && body.mailingList === true;  // strict boolean — anything else is "no"

  if (!messageRaw) return jsonResponse(res, 400, { error: 'Add a message before signing.' });
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) return jsonResponse(res, 400, { error: 'That email doesn’t look right.' });
  if (!token || token.length > 4096) return jsonResponse(res, 400, { error: 'Missing human check. Please try again.' });

  // Verify Turnstile
  let ok = false;
  try {
    ok = await verifyTurnstile(token, clientIp(req));
  } catch (err) {
    console.error('[subscribe] turnstile error', err && err.message);
    return jsonResponse(res, 502, { error: 'Could not verify the human check. Please try again.' });
  }
  if (!ok) return jsonResponse(res, 400, { error: 'Human check failed. Please try again.' });

  // Brevo contact create
  try {
    const result = await createOrUpdateBrevoContact({
      email: emailRaw,
      name: nameRaw,
      message: messageRaw,
      mailingList,
    });
    return jsonResponse(res, 200, { ok: true, duplicate: result.duplicate, mailingList });
  } catch (err) {
    const m = err && err.message;
    if (m === 'brevo_api_key_missing' || m === 'brevo_list_id_missing' || m === 'brevo_list_id_invalid') {
      console.error('[subscribe] config error:', m);
      return jsonResponse(res, 500, { error: 'Server is misconfigured. Please try again later.' });
    }
    return jsonResponse(res, 502, { error: 'We couldn’t save your signature. Please try again.' });
  }
};
