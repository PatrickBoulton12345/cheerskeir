// /api/count — returns the current Brevo list size for the live ticker.
// Cached on Vercel's edge for 60s (stale-while-revalidate up to 5 min)
// so we don't hammer Brevo on every page view.
//
// Required env vars:
//   BREVO_API_KEY
//   BREVO_LIST_ID

const BREVO_BASE = 'https://api.brevo.com/v3';

function jsonResponse(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return jsonResponse(res, 405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  const listIdRaw = process.env.BREVO_LIST_ID;
  if (!apiKey || !listIdRaw) {
    // Don't 500 — return a soft zero so the page still renders.
    return jsonResponse(res, 200, { count: 0 }, 'public, s-maxage=60, stale-while-revalidate=300');
  }
  const listId = parseInt(listIdRaw, 10);
  if (!Number.isFinite(listId)) {
    return jsonResponse(res, 200, { count: 0 }, 'public, s-maxage=60, stale-while-revalidate=300');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);

  try {
    const resp = await fetch(`${BREVO_BASE}/contacts/lists/${listId}`, {
      method: 'GET',
      headers: {
        'api-key': apiKey,
        'Accept': 'application/json',
      },
      signal: ctrl.signal,
    });

    if (!resp.ok) {
      console.error('[count] brevo list lookup failed', resp.status);
      return jsonResponse(res, 200, { count: 0 }, 'public, s-maxage=30');
    }

    const data = await resp.json();
    // Prefer uniqueSubscribers, fall back to totalSubscribers; clamp to non-negative integer.
    let n = data && (data.uniqueSubscribers ?? data.totalSubscribers);
    n = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;

    return jsonResponse(res, 200, { count: n }, 'public, s-maxage=60, stale-while-revalidate=300');
  } catch (err) {
    console.error('[count] error', err && err.message);
    return jsonResponse(res, 200, { count: 0 }, 'public, s-maxage=30');
  } finally {
    clearTimeout(timer);
  }
};
