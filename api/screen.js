// The student screen's relay. An iPad opens /screen/ and gets a short code; the instructor's phone (signed in)
// pairs with that code and sends it "show this" items: a sim, a picture, a video. The iPad asks every second
// whether anything changed. State lives in Upstash Redis (Vercel Storage, free plan) for 12 hours.
//
//   POST {op:'new'}                         anyone: a new screen → {c, k}
//   GET  ?op=poll&c&k&v                     the screen: {same:true} or the whole state
//   GET  ?op=state&c                        instructor: the whole state
//   POST {op:'claim'|'send'|'go'|'blank'|'clear'|'remove', c, ...}   instructor only
import { validToken, readCookie, makeToken, COOKIE, SCREEN_COOKIE } from '../lib/auth.js';

const TTL = 12 * 3600;
const MAX_ITEM = 350_000;  // characters; a big inline diagram fits, a photo is sent by its address
const MAX_DECK = 60;
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ---- storage: Upstash REST, or memory when it isn't set up (local testing only) ----
const R_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = (globalThis.__cfiScreens ||= new Map());
async function redis(cmd) {
  if (!R_URL()) {
    const [op, key, val] = cmd;
    if (op === 'GET') return mem.get(key) ?? null;
    if (op === 'SET') { if (cmd.includes('NX') && mem.has(key)) return null; mem.set(key, val); return 'OK'; }
    if (op === 'DEL') { mem.delete(key); return 1; }
    return null;
  }
  const r = await fetch(R_URL(), { method: 'POST', headers: { authorization: `Bearer ${R_TOK()}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
const kState = (c) => `scr:${c}`, kVer = (c) => `scrv:${c}`;
const load = async (c) => { const s = await redis(['GET', kState(c)]); return s ? JSON.parse(s) : null; };
async function save(c, s) {
  s.v = (s.v || 0) + 1;
  await redis(['SET', kState(c), JSON.stringify(s), 'EX', TTL]);
  await redis(['SET', kVer(c), `${s.v}:${s.k}`, 'EX', TTL]);
  return s;
}

// ---- helpers ----
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const rand = (n, abc) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => abc[x % abc.length]).join(''); };
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const isInstructor = (req) => validToken(readCookie(req, COOKIE), process.env.CFI_SECRET);
const pub = (s) => ({ v: s.v, paired: !!s.paired, at: s.at, blank: !!s.blank, deck: s.deck, ptr: s.ptr || null });
const itemKey = (it) => it.kind === 'sim' ? `sim:${it.id}` : it.kind === 'video' ? `video:${it.vid || it.src}` : `html:${it.key || ''}`;

export async function GET(req) {
  const u = new URL(req.url);
  const op = u.searchParams.get('op'), c = cleanCode(u.searchParams.get('c'));
  if (!c) return json({ error: 'code' }, 400);
  try {
    if (op === 'poll') {
      const ver = await redis(['GET', kVer(c)]);
      if (!ver) return json({ gone: true });
      const [v, k] = String(ver).split(':');
      if (k !== u.searchParams.get('k')) return json({ error: 'key' }, 403);
      if (v === u.searchParams.get('v')) return json({ same: true });
      const s = await load(c);
      if (!s) return json({ gone: true });
      // Once paired, the screen may load the pictures sent to it (lesson pictures are otherwise signed-in only).
      const extra = s.paired && process.env.CFI_SECRET
        ? { 'set-cookie': `${SCREEN_COOKIE}=${await makeToken(process.env.CFI_SECRET, 'scr', 0.5)}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax` } : {};
      return json(pub(s), 200, extra);
    }
    if (op === 'state') {
      if (!(await isInstructor(req))) return json({ error: 'signin' }, 401);
      const s = await load(c);
      return s ? json(pub(s)) : json({ gone: true });
    }
  } catch (e) { return json({ error: 'store', detail: String(e.message || e) }, 503); }
  return json({ error: 'op' }, 400);
}

export async function POST(req) {
  let b; try { b = await req.json(); } catch { return json({ error: 'body' }, 400); }
  try {
    if (b.op === 'new') {
      for (let i = 0; i < 5; i++) {
        const c = rand(6, ABC), k = hex(16);
        const s = { k, v: 1, paired: false, at: -1, blank: false, deck: [] };
        if (await redis(['SET', kState(c), JSON.stringify(s), 'EX', TTL, 'NX'])) {
          await redis(['SET', kVer(c), `1:${k}`, 'EX', TTL]);
          return json({ c, k });
        }
      }
      return json({ error: 'busy' }, 503);
    }
    if (!(await isInstructor(req))) return json({ error: 'signin' }, 401);
    const c = cleanCode(b.c);
    const s = c && (await load(c));
    if (!s) return json({ error: 'nocode' }, 404);
    switch (b.op) {
      case 'claim': s.paired = true; break;
      case 'send': {
        const it = b.item || {};
        if (!['sim', 'video', 'html'].includes(it.kind) || JSON.stringify(it).length > MAX_ITEM) return json({ error: 'item' }, 400);
        const key = itemKey(it), at = s.deck.findIndex((x) => itemKey(x) === key);
        if (at >= 0) { s.deck[at] = it; s.at = at; }
        else { s.deck.push(it); if (s.deck.length > MAX_DECK) s.deck.shift(); s.at = s.deck.length - 1; }
        s.blank = false; s.paired = true; break;
      }
      case 'go': s.at = Math.max(0, Math.min(s.deck.length - 1, Number(b.at) | 0)); s.blank = false; break;
      case 'blank': s.blank = !!b.on; break;
      case 'remove': { const i = Number(b.at) | 0; s.deck.splice(i, 1); if (s.at >= s.deck.length) s.at = s.deck.length - 1; break; }
      case 'clear': s.deck = []; s.at = -1; s.blank = false; break;
      case 'unpair': await redis(['DEL', kState(c)]); await redis(['DEL', kVer(c)]); return json({ ok: true });
      default: return json({ error: 'op' }, 400);
    }
    return json(pub(await save(c, s)));
  } catch (e) { return json({ error: 'store', detail: String(e.message || e) }, 503); }
}
