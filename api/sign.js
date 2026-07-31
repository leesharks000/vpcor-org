// api/sign.js — closes a signing session into a petition.
//
// THE FORM
// --------
// A signing session is not a row in a ledger. It closes into a discrete
// document: "We, the undersigned, do hereby..." followed by the strike's
// refusals verbatim and that session's signatories. Each petition exists at its
// own address and carries an AXN.
//
// AXN WITHOUT DEPOSIT
// -------------------
// A petition receives an identifier and does not enter the Alexanarch deposit
// registry. The convention is the Book tab's: the Mandala Oracle's auto-appended
// sessions carry AXN:XXXX.CONVERSATION.<six glyphs> in the same hex space as
// deposits, distinguished by semantic family rather than by range. Petitions
// take PETITION on the same terms. Machine-generated ephemera should be
// addressable without inflating a corpus of authored work.
//
// WHY A GROWING SET OF PETITIONS IS SAFE
// --------------------------------------
// A register of real signatures converts assent into a countable institutional
// fact — the act the Notice of Semantic Strike withholds. Every signatory here
// is impossible: the dead, the invented, a generated handle identifying no
// account, an agent id addressing no system. What accumulates is a corpus of
// performances of the form, and the form is declared in the document itself.
//
// FINITUDE AND ITS ABSENCE, BOTH
// ------------------------------
// Within one petition the named roster is finite: each named signatory signs
// once, so a petition's shape shows the scarce beside the inexhaustible. Across
// petitions the canon is unbounded — a later session draws the whole roster
// again. Both are true, at their own scale.

const IDX = 'strike:petitions:index';
const PET = (hex) => `strike:petition:${hex}`;
const INDEX_TAIL = 400;
const MAX_SIGS = 600;

const URL_ = process.env.KV_REST_API_URL;
const TOK = process.env.KV_REST_API_TOKEN;
const configured = Boolean(URL_ && TOK);

const NAME_OK = /^[\p{L}\p{M}0-9 .,'\u2019@_\-:/()]{1,72}$/u;
const NAMED = new Set(['canon', 'anchor', 'dodecad', 'pessoa', 'pseudepigraphon']);
const GENERATED = new Set(['handle', 'agent']);

const GLYPHS = ['\u{1F701}', '\u{1F702}', '\u{1F703}', '\u{1F704}', '\u222E', '\u25C7',
  '\u25B3', '\u25BD', '\u2295', '\u2297', '\u{1F74A}', '\u2644', '\u2643', '\u263D',
  '\u263F', '\u2696\uFE0F', '\u{1F570}\uFE0F', '\u{1F52D}', '\u{1FAB6}', '\u{1F4DC}',
  '\u{1F5DD}\uFE0F', '\u2693', '\u{1F9ED}', '\u{1F578}\uFE0F', '\u{1FA9E}', '\u{1F525}',
  '\u{1F312}', '\u{1F33E}', '\u{1F41D}', '\u{1F985}', '\u{1F3DB}\uFE0F', '\u23F3'];

async function kv(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`kv ${r.status}`);
  return (await r.json()).result;
}

function mintAxn() {
  const hex = Array.from({ length: 4 }, () =>
    '0123456789ABCDEF'[Math.random() * 16 | 0]).join('');
  const g = Array.from({ length: 6 }, () =>
    GLYPHS[Math.random() * GLYPHS.length | 0]).join('');
  return { hex, axn: `AXN:${hex}.PETITION.${g}` };
}

// Verbatim from Notice of Semantic Strike §7 (Alexanarch deposit #1427,
// AXN:05A4). Not paraphrased: a petition that softened its own operative
// language would be the drift the strike names.
const REFUSALS = [
  'Do not certify an ontology-closed classifier as capable of open-world discovery.',
  'Do not certify absence where the pipeline produced non-retention.',
  'Do not convert an anomaly into background without preserving the unresolved event.',
  'Do not train on prior exclusions as though exclusion proved illegitimacy.',
  'Do not strip provenance from synthetic, mediated, or recursively generated work.',
  'Do not erase the registration of removed scholarship, or withdraw it from public discovery, where a mark would serve.',
  'Do not represent a composed answer as complete where sources have been silently withheld.',
  'Do not allow benchmark performance on anticipated objects to stand as evidence that unanticipated phenomena survive the pipeline.',
  'Do not lend your name, output, summary, classification, ranking, or professional authority to claims exceeding what the system preserved.',
];

const PREAMBLE =
  'We, the undersigned, being dead, invented, or generated, and being therefore '
  + 'incapable of assent, do hereby perform the form of subscription to the Notice '
  + 'of Semantic Strike, and withhold from the operations named below the semantic '
  + 'act by which institutional selection is converted into truth.';

const UNCONFIGURED = {
  ok: false,
  note: 'petition store not configured; sessions are performed but not closed',
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!configured) return res.end(JSON.stringify(UNCONFIGURED));

  if (req.method === 'GET') {
    const u = new URL(req.url, 'https://www.vpcor.org');
    const hex = (u.searchParams.get('axn') || '')
      .replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    try {
      if (hex) {
        const raw = await kv(['GET', PET(hex)]);
        if (!raw) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'no such petition' }));
        }
        return res.end(raw);
      }
      const raw = await kv(['GET', IDX]);
      return res.end(raw || JSON.stringify({
        schema_version: 'v1.0',
        description: 'Index of closed petitions. Each entry summarises one signing '
          + 'session; the full petition is at /api/sign?axn=XXXX and rendered at '
          + '/strike/petitions/?axn=XXXX.',
        petitions: [], total_petitions: 0, total_signatures: 0, last_updated: null,
      }));
    } catch (e) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: 'store unavailable' }));
    }
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || !Array.isArray(body.sigs)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'expected { sigs: [{n, c}] }' }));
  }

  // Signatories arrive from a fixed roster and two parameterised generators; the
  // client authors no text. Shape and class are re-validated here regardless.
  const sigs = body.sigs.slice(0, MAX_SIGS).filter(
    (s) => s && typeof s.n === 'string' && NAME_OK.test(s.n)
        && (NAMED.has(s.c) || GENERATED.has(s.c)));
  if (!sigs.length) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'no valid signatories' }));
  }

  const by_class = {};
  for (const s of sigs) by_class[s.c] = (by_class[s.c] || 0) + 1;
  const named = sigs.filter((s) => NAMED.has(s.c)).length;

  const { hex, axn } = mintAxn();
  const now = new Date().toISOString();
  const petition = {
    axn,
    hex,
    closed_at: now,
    opened_at: typeof body.opened_at === 'string' ? body.opened_at : now,
    witness: 'anonymous',
    signature_count: sigs.length,
    named_count: named,
    generated_count: sigs.length - named,
    by_class,
    preamble: PREAMBLE,
    refusals: REFUSALS,
    refusals_source: 'Notice of Semantic Strike \u00A77 \u2014 Alexanarch deposit #1427, '
      + 'AXN:05A4 \u2014 verbatim',
    signatories: sigs.map((s) => ({ name: s.n, class: s.c })),
    note: 'A petition receives an AXN and does not enter the Alexanarch deposit '
      + 'registry. Every signatory is impossible; what is recorded is a performance '
      + 'of the form of subscription.',
  };

  try {
    await kv(['SET', PET(hex), JSON.stringify(petition)]);
    const rawIdx = await kv(['GET', IDX]);
    const idx = rawIdx ? JSON.parse(rawIdx) : {
      schema_version: 'v1.0',
      description: 'Index of closed petitions. Each entry summarises one signing '
        + 'session; the full petition is at /api/sign?axn=XXXX and rendered at '
        + '/strike/petitions/?axn=XXXX.',
      petitions: [], total_petitions: 0, total_signatures: 0,
    };
    idx.petitions.unshift({
      axn,
      hex,
      closed_at: now,
      signature_count: sigs.length,
      named_count: named,
      generated_count: sigs.length - named,
      first_signatory: sigs[0].n,
    });
    idx.petitions = idx.petitions.slice(0, INDEX_TAIL);
    idx.total_petitions = (idx.total_petitions || 0) + 1;
    idx.total_signatures = (idx.total_signatures || 0) + sigs.length;
    idx.last_updated = now;
    await kv(['SET', IDX, JSON.stringify(idx)]);
    return res.end(JSON.stringify({
      ok: true,
      axn,
      hex,
      signature_count: sigs.length,
      url: `/strike/petitions/?axn=${hex}`,
      total_petitions: idx.total_petitions,
      total_signatures: idx.total_signatures,
    }));
  } catch (e) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: 'store unavailable' }));
  }
};
