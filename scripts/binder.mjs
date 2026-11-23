#!/usr/bin/env node
// Claude's way into the binder's Firestore (the app's content lives there, see src/scripts/cloud.ts).
// Uses a Firebase service account: the JSON key in the environment variable FIREBASE_SERVICE_ACCOUNT (the
// whole file's text), or a path to it in GOOGLE_APPLICATION_CREDENTIALS.
//
//   node scripts/binder.mjs status              what's in Firestore (and which pages need rendering)
//   node scripts/binder.mjs pull                Firestore → src/content/lessons/*.mdx + src/data/outline.json
//   node scripts/binder.mjs push <slug…>        build the site, then send those lessons (source + page) up
//   node scripts/binder.mjs push --all          …every lesson in src/content/lessons (after a component change)
//   node scripts/binder.mjs push --outline      send src/data/outline.json up as the folder list
//   node scripts/binder.mjs render              pull + build + push the pages whose source was edited by hand
//
// Always pull first: push refuses a lesson that changed in the app since your pull (--force overrides).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { parseHTML } from 'linkedom';

const ROOT = new URL('..', import.meta.url).pathname;
const LESSONS = join(ROOT, 'src/content/lessons');
const OUTLINE = join(ROOT, 'src/data/outline.json');
const PULLED = join(ROOT, '.binder/pulled.json');
const cfg = JSON.parse(readFileSync(join(ROOT, 'src/data/firebase.json'), 'utf8'));

function account() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || (process.env.GOOGLE_APPLICATION_CREDENTIALS && readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (!raw) throw new Error('No service account: set FIREBASE_SERVICE_ACCOUNT (the key file\'s JSON) or GOOGLE_APPLICATION_CREDENTIALS.');
  return JSON.parse(raw);
}
let sa, PROJECT, DOCS;
const EMU = process.env.FIRESTORE_EMULATOR_HOST; // testing against the local emulator: no key needed
function init() {
  if (EMU) { PROJECT = process.env.FIREBASE_PROJECT_ID || cfg.projectId; DOCS = `http://${EMU}/v1/projects/${PROJECT}/databases/(default)/documents`; return; }
  sa ??= account();
  PROJECT = cfg.projectId || sa.project_id;
  DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
}
const b64u = (s) => Buffer.from(s).toString('base64url');

let tokenP;
async function token() {
  if (EMU) return 'owner';
  return (tokenP ??= (async () => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key).toString('base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${claim}.${sig}` });
    const j = await r.json();
    if (!j.access_token) throw new Error(`Google refused the service account: ${JSON.stringify(j)}`);
    return j.access_token;
  })());
}
async function api(path, init = {}) {
  const r = await fetch(path.startsWith('http') ? path : `${DOCS}/${path}`, { ...init, headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  if (r.status === 404) return null;
  const j = await r.json();
  if (!r.ok) throw new Error(`Firestore ${r.status}: ${j.error?.message || JSON.stringify(j)}`);
  return j;
}
const enc = (v) => v === null || v === undefined ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: String(v) };
const dec = (f) => 'stringValue' in f ? f.stringValue : 'integerValue' in f ? Number(f.integerValue) : 'doubleValue' in f ? f.doubleValue : 'booleanValue' in f ? f.booleanValue : 'timestampValue' in f ? f.timestampValue : null;
const fieldsOf = (doc) => Object.fromEntries(Object.entries(doc?.fields || {}).map(([k, v]) => [k, dec(v)]));
const get = async (path) => { const d = await api(path); return d ? fieldsOf(d) : null; };
/** Merge these fields into the document (creates it if needed). */
async function set(path, data) {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  await api(`${path}?${mask}`, { method: 'PATCH', body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }) });
}
async function list(coll) {
  const out = [];
  let page = '';
  do {
    const j = await api(`${coll}?pageSize=100${page ? `&pageToken=${page}` : ''}`);
    for (const d of j?.documents || []) out.push(fieldsOf(d));
    page = j?.nextPageToken || '';
  } while (page);
  return out;
}

const idOf = (p) => p.replace(/\//g, '~');
const lessonPath = (slug) => `lessons/${idOf(slug)}`;
const titleOf = (mdx) => { const m = mdx.match(/^title:[ \t]*(.*)$/m); if (!m) return ''; try { return JSON.parse(m[1]); } catch { return m[1].replace(/^'(.*)'$/, '$1').trim(); } };
const pulled = () => (existsSync(PULLED) ? JSON.parse(readFileSync(PULLED, 'utf8')) : {});
const savePulled = (p) => { mkdirSync(dirname(PULLED), { recursive: true }); writeFileSync(PULLED, JSON.stringify(p, null, 2)); };
const repoLessons = (dir = LESSONS) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? repoLessons(p) : /\.mdx?$/.test(f) ? [relative(LESSONS, p).replace(/\.mdx?$/, '')] : []; });

async function status() {
  const [ls, o, meta] = await Promise.all([list('lessons'), get('binder/outline'), get('binder/meta')]);
  console.log(`Project ${PROJECT}: ${meta ? 'seeded' : 'NOT seeded yet (David signs in once to copy the site in)'}; outline ${o ? `saved ${new Date(o.at).toLocaleString()}` : 'missing'}`);
  for (const l of ls.sort((a, b) => a.slug.localeCompare(b.slug))) console.log(`${l.stale ? '! needs render ' : '               '}${l.slug}  "${l.title}"  ${new Date(l.at).toLocaleString()} by ${l.by || '?'}  (mdx ${l.mdx?.length || 0}, html ${l.html?.length || 0})`);
}

async function pull() {
  const [ls, o] = await Promise.all([list('lessons'), get('binder/outline')]);
  const p = { lessons: {}, outline: o?.at || 0, at: Date.now() };
  if (o?.json) writeFileSync(OUTLINE, o.json.endsWith('\n') ? o.json : o.json + '\n');
  for (const l of ls) {
    if (!l.mdx) continue;
    const f = join(LESSONS, `${l.slug}.mdx`);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, l.mdx);
    p.lessons[l.slug] = l.at || 0;
  }
  const extra = repoLessons().filter((s) => !(s in p.lessons));
  savePulled(p);
  console.log(`Pulled ${ls.length} lessons and the folder list.${extra.length ? ` In the repo but not in Firestore (deleted in the app, or new here): ${extra.join(', ')}` : ''}`);
}

function articleOf(slug) {
  const f = join(ROOT, 'dist', slug, 'index.html');
  if (!existsSync(f)) throw new Error(`No built page for ${slug} (dist/${slug}/index.html). Is it in src/content/lessons?`);
  const { document } = parseHTML(readFileSync(f, 'utf8'));
  const a = document.querySelector('[data-article]');
  if (!a) throw new Error(`No <article data-article> in dist/${slug}/index.html`);
  return a.innerHTML;
}
const build = () => execSync('npx astro build', { cwd: ROOT, stdio: 'inherit' });

async function push(args) {
  const force = args.includes('--force'), noBuild = args.includes('--no-build');
  const p = pulled();
  if (args.includes('--outline')) {
    const cur = await get('binder/outline');
    if (cur && !force && (cur.at || 0) !== (p.outline || 0)) throw new Error('The folder list changed in the app since your pull. Pull again (or --force).');
    const json = readFileSync(OUTLINE, 'utf8'); JSON.parse(json);
    const at = Date.now();
    await set('binder/outline', { json, at, by: 'claude' });
    p.outline = at; savePulled(p);
    console.log('Pushed the folder list.');
  }
  let slugs = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--all')) slugs = repoLessons();
  if (!slugs.length) return;
  if (!noBuild) build();
  for (const slug of slugs) {
    const f = [join(LESSONS, `${slug}.mdx`), join(LESSONS, `${slug}.md`)].find(existsSync);
    if (!f) throw new Error(`No src/content/lessons/${slug}.mdx`);
    const cur = await get(lessonPath(slug));
    if (cur && !force && (cur.at || 0) !== (p.lessons?.[slug] || 0)) { console.error(`SKIPPED ${slug}: changed in the app since your pull. Pull again, redo your change, then push (or --force).`); process.exitCode = 1; continue; }
    const mdx = readFileSync(f, 'utf8'), html = articleOf(slug);
    if (html.length > 900_000) throw new Error(`${slug} renders to ${html.length} characters, over Firestore's 1 MB a document. Split the lesson.`);
    const at = Date.now();
    await set(lessonPath(slug), { slug, title: titleOf(mdx), mdx, base: mdx, html, stale: false, at, by: 'claude' });
    (p.lessons ||= {})[slug] = at;
    console.log(`Pushed ${slug}${cur ? '' : ' (new: add it to the folder list too, then push --outline)'}`);
  }
  savePulled(p);
}

async function render() {
  await pull();
  const stale = (await list('lessons')).filter((l) => l.stale).map((l) => l.slug);
  if (!stale.length) { console.log('Every page is up to date.'); return; }
  await push(stale);
}

const [cmd, ...args] = process.argv.slice(2);
const run = { status, pull, push: () => push(args), render }[cmd];
if (!run) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(cmd ? 1 : 0); }
try { init(); } catch (e) { console.error(e.message); process.exit(1); }
run().catch((e) => { console.error(e.message || e); process.exit(1); });
