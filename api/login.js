// POST /api/login (form: user, pass, next). Checks against CFI_USER / CFI_PASS (Vercel environment variables)
// and sets the sign-in cookie. GET /api/login?out=1 signs out.
import { makeToken, COOKIE, DAYS } from '../lib/auth.js';

const same = (a, b) => { a = String(a || ''); b = String(b || ''); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');
const go = (to, cookie) => new Response(null, { status: 303, headers: { location: to, ...(cookie ? { 'set-cookie': cookie } : {}), 'cache-control': 'no-store' } });

export async function GET(req) {
  const u = new URL(req.url);
  if (u.searchParams.get('out')) return go('/interactives/', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return go('/login/');
}

export async function POST(req) {
  const { CFI_USER, CFI_PASS, CFI_SECRET } = process.env;
  const f = await req.formData();
  const next = safeNext(f.get('next'));
  // Not set up yet, or wrong: back to the sign-in page (a short pause makes guessing slow).
  if (!CFI_USER || !CFI_PASS || !CFI_SECRET || !(same(f.get('user'), CFI_USER) & same(f.get('pass'), CFI_PASS))) {
    await new Promise((r) => setTimeout(r, 800));
    return go(`/login/?e=1&next=${encodeURIComponent(next)}`);
  }
  const token = await makeToken(CFI_SECRET);
  return go(next, `${COOKIE}=${token}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
}
