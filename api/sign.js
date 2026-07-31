// api/sign.js — the collective ledger for the strike signature surface.
//
// WHY THIS IS SAFE WHERE A SIGNATURE REGISTER WOULD NOT BE
// --------------------------------------------------------
// A register of real signatures converts assent into a countable institutional
// fact — the precise act the Notice of Semantic Strike withholds. Nothing here
// purports to be assent. Every signatory is impossible: the dead, the invented,
// a generated handle identifying no account, an agent id addressing no system.
// What accumulates is participation in a declared fiction. The count counts
// performances, and converts nothing into a fact about anyone.
//
// It is also unexploitable in the way an open write endpoint usually is: the
// client submits no free text it authored. Names arrive from a fixed roster and
// two parameterised generators, and the server re-validates their shape before
// storing. There is nothing here to inject.
//
// WRITE DISCIPLINE
// ----------------
// The client batches a whole visit and flushes once, on idle or page hide, so a
// visitor who signs two hundred times produces one write. The server stores a
// single object — counters plus a rolling tail of the most recent signatures —
// so storage is bounded regardless of traffic. No IP is inspected and no
// visitor is identified.
//
// STORAGE
// -------
// Uses Vercel KV when the project has a store connected (KV_REST_API_URL and
// KV_REST_API_TOKEN are injected automatically on connection). With no store,
// every request answers honestly that the ledger is not yet keeping count, and
// the page works exactly as it does without it.

const KEY = 'strike:ledger';
const TAIL = 60;          // signatures retained for display
const MAX_BATCH = 500;    // per flush; a visit longer than this is truncated

const URL_ = process.env.KV_REST_API_URL;
const TOK = process.env.KV_REST_API_TOKEN;
const configured = Boolean(URL_ && TOK);

// Names are generated, never authored. Anything outside this shape is discarded
// rather than stored — the roster and the generators cannot produce it.
const NAME_OK = /^[\p{L}\p{M}0-9 .,'’@_\-:/()]{1,72}$/u;
const CLASSES = new Set(['canon', 'anchor', 'dodecad', 'pessoa',
                         'pseudepigraphon', 'handle', 'agent']);

async function kv(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`kv ${r.status}`);
  const j = await r.json();
  return j.result;
}

const empty = () => ({ total: 0, by_class: {}, recent: [], since: '2026-07-31' });

async function read() {
  if (!configured) return null;
  try {
    const raw = await kv(['GET', KEY]);
    return raw ? JSON.parse(raw) : empty();
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const led = await read();
    return res.end(JSON.stringify(led
      ? { total: led.total, by_class: led.by_class, recent: led.recent.slice(0, 12),
          since: led.since }
      : { total: null, note: 'ledger not configured; signatures are performed but not counted' }));
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  if (!configured) {
    // Honest rather than silent: the page is told the count is not being kept.
    return res.end(JSON.stringify({
      total: null,
      note: 'ledger not configured; signatures are performed but not counted',
    }));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !Array.isArray(body.sigs)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'expected { sigs: [{n, c}] }' }));
  }

  const sigs = body.sigs.slice(0, MAX_BATCH).filter(
    (s) => s && typeof s.n === 'string' && NAME_OK.test(s.n) && CLASSES.has(s.c));
  if (!sigs.length) {
    const led = await read();
    return res.end(JSON.stringify({ total: led ? led.total : null, accepted: 0 }));
  }

  try {
    const led = (await read()) || empty();
    led.total += sigs.length;
    for (const s of sigs) led.by_class[s.c] = (led.by_class[s.c] || 0) + 1;
    led.recent = sigs.map((s) => ({ n: s.n, c: s.c })).reverse()
      .concat(led.recent).slice(0, TAIL);
    await kv(['SET', KEY, JSON.stringify(led)]);
    return res.end(JSON.stringify({ total: led.total, accepted: sigs.length }));
  } catch (e) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: 'ledger unavailable', total: null }));
  }
};
