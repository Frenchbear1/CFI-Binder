// Upload from any signed-in device: the binder keeps David's GitHub key on the server, so a new phone or laptop
// doesn't ask for it again. The key comes from the env var GITHUB_TOKEN if it's set, else from the key a device
// saved here (encrypted with CFI_SECRET, in the same Upstash store as the student screen). Only the signed-in
// instructor can use it, and only for this one repo's files (git data and contents).
//
//   GET  ?op=status                       → { ready }
//   POST { op:'key', token }              save a key (checked with GitHub first)
//   POST { op:'call', path, method, body } one GitHub API call on the repo
import { validToken, readCookie, COOKIE } from '../lib/auth.js';
import { redis } from '../lib/kv.js';

const REPO = process.env.CFI_REPO || 'Frenchbear1/CFI-Binder';
const KEY = 'cfi:ghkey';
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const isInstructor = (req) => validToken(readCookie(req, COOKIE), process.env.CFI_SECRET);
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => Buffer.from(u8).toString('base64'), unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
async function aes() {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`${process.env.CFI_SECRET}:github-key`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(t) { const iv = crypto.getRandomValues(new Uint8Array(12)); return `${b64(iv)}.${b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(), enc.encode(t))))}`; }
async function open(s) { const [iv, ct] = s.split('.'); return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aes(), unb64(ct))); }
async function key() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const s = await redis(['GET', KEY]).catch(() => null);
  if (!s) return '';
  try { return await open(String(s)); } catch { return ''; }
}
const call = (tok, path, init = {}) => fetch(`https://api.github.com/repos/${REPO}/${path}`, { ...init, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${tok}`, 'user-agent': 'cfi-binder', 'x-github-api-version': '2022-11-28', ...(init.body ? { 'content-type': 'application/json' } : {}) } });

export async function GET(req) {
  if (!(await isInstructor(req))) return json({ error: 'signin' }, 401);
  return json({ ready: !!(await key()), env: !!process.env.GITHUB_TOKEN });
}

export async function POST(req) {
  if (!(await isInstructor(req))) return json({ error: 'signin' }, 401);
  let b; try { b = await req.json(); } catch { return json({ error: 'body' }, 400); }
  try {
    if (b.op === 'key') {
      const t = String(b.token || '').trim();
      if (!/^(github_pat_|ghp_|gho_|ghu_|ghs_)[\w]+$/.test(t)) return json({ error: 'That doesn’t look like a GitHub key.' }, 400);
      const r = await call(t, 'contents/package.json?ref=main');
      if (!r.ok) return json({ error: 'GitHub didn’t accept that key for the binder’s repo.' }, 400);
      await redis(['SET', KEY, await seal(t)]);
      return json({ ok: true });
    }
    if (b.op === 'forget') { await redis(['DEL', KEY]); return json({ ok: true }); }
    if (b.op === 'call') {
      const path = String(b.path || ''), method = String(b.method || 'GET').toUpperCase();
      // Only what Upload and reading files need.
      if (!/^(git\/(ref|refs|commits|blobs|trees)(\/[\w./%-]*)?|contents\/[\w./%-]+)(\?[\w=&.%-]*)?$/.test(path) || path.includes('..') || !['GET', 'POST', 'PATCH'].includes(method)) return json({ error: 'path' }, 400);
      const tok = await key();
      if (!tok) return json({ error: 'nokey' }, 409);
      const r = await call(tok, path, { method, body: b.body == null ? undefined : JSON.stringify(b.body) });
      return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    return json({ error: 'op' }, 400);
  } catch (e) { return json({ error: e.setup ? 'setup' : 'store' }, 503); }
}
