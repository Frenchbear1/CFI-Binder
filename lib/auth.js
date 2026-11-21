// The binder's sign-in cookie: "<expiry>.<signature>", signed with CFI_SECRET (an HMAC, so it can't be forged).
// Shared by middleware.js (checks it on every request) and api/login.js (hands it out).
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sign(text, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
export const COOKIE = 'cfi_auth';
export const DAYS = 180;
// kind keeps the two cookies apart: 'cfi' is the instructor's sign-in, 'scr' is a paired student screen
// (it may load lesson pictures that were sent to it, nothing else).
export async function makeToken(secret, kind = 'cfi', days = DAYS) {
  const exp = Date.now() + days * 864e5;
  return `${exp}.${await sign(`${kind}:${exp}`, secret)}`;
}
export async function validToken(token, secret, kind = 'cfi') {
  if (!token || !secret) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = await sign(`${kind}:${exp}`, secret);
  if (want.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
export const readCookie = (req, name) => {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
};
export const SCREEN_COOKIE = 'cfi_screen';
