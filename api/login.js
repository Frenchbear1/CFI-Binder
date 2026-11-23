// Signing in to the binder sets one cookie (lib/auth.js) that middleware.js checks on every request.
//
// POST /api/login, JSON { idToken }: the Google sign-in from the app (Firebase Auth). The token is shown to
// Firestore, whose rules (firestore.rules) let only the binder's owner read: if Firestore lets this account
// read the binder, it's the owner, and the cookie is set. Nothing about who the owner is lives here.
// POST /api/login, form { user, pass, next }: the old username and password (CFI_USER / CFI_PASS), used until
// the binder has a Firebase project.
// GET /api/login?out=1 signs out.
import { readFileSync } from 'node:fs';
import { makeToken, COOKIE, DAYS } from '../lib/auth.js';

const same = (a, b) => { a = String(a || ''); b = String(b || ''); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');
const go = (to, cookie) => new Response(null, { status: 303, headers: { location: to, ...(cookie ? { 'set-cookie': cookie } : {}), 'cache-control': 'no-store' } });
const json = (b, status = 200, cookie) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) } });
const cookieOf = (token) => `${COOKIE}=${token}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;

function projectId() {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try { return JSON.parse(readFileSync(new URL('../src/data/firebase.json', import.meta.url), 'utf8')).projectId || ''; } catch { return ''; }
}

export async function GET(req) {
  const u = new URL(req.url);
  if (u.searchParams.get('out')) return go('/interactives/', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return go('/login/');
}

export async function POST(req) {
  const { CFI_USER, CFI_PASS, CFI_SECRET } = process.env;
  if ((req.headers.get('content-type') || '').includes('application/json')) {
    const pid = projectId();
    if (!CFI_SECRET || !pid) return json({ error: 'The binder’s sign-in isn’t set up yet (CFI_SECRET or the Firebase project is missing).' }, 503);
    let idToken = '';
    try { idToken = String((await req.json()).idToken || ''); } catch {}
    if (!idToken || idToken.length > 4096) return json({ error: 'No Google sign-in came with that.' }, 400);
    const host = process.env.FIRESTORE_EMULATOR_HOST ? `http://${process.env.FIRESTORE_EMULATOR_HOST}` : 'https://firestore.googleapis.com';
    const r = await fetch(`${host}/v1/projects/${encodeURIComponent(pid)}/databases/(default)/documents/binder/meta`, { headers: { authorization: `Bearer ${idToken}` } }).catch(() => null);
    // 200 = it read the binder; 404 = allowed to read, the binder just isn't filled yet (first sign-in).
    if (!r || !(r.status === 200 || r.status === 404)) {
      await new Promise((ok) => setTimeout(ok, 600));
      return json({ error: r?.status === 403 ? 'That Google account doesn’t have access to this binder.' : r?.status === 401 ? 'Google sign-in expired. Try again.' : 'Couldn’t check your sign-in. Try again.' }, 403);
    }
    return json({ ok: true }, 200, cookieOf(await makeToken(CFI_SECRET)));
  }
  const f = await req.formData();
  const next = safeNext(f.get('next'));
  // Not set up yet, or wrong: back to the sign-in page (a short pause makes guessing slow).
  if (!CFI_USER || !CFI_PASS || !CFI_SECRET || !(same(f.get('user'), CFI_USER) & same(f.get('pass'), CFI_PASS))) {
    await new Promise((r) => setTimeout(r, 800));
    return go(`/login/?e=1&next=${encodeURIComponent(next)}`);
  }
  const token = await makeToken(CFI_SECRET);
  return go(next, cookieOf(token));
}
