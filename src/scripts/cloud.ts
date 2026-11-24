// The binder's content lives in David's Firebase project: Google sign-in (Firebase Auth) and Firestore,
// which keeps a copy on each device (works offline) and syncs every change to his other devices in about a
// second. Nothing waits for the network: a write lands in the device's copy straight away and goes up
// whenever there's a connection.
//
// Firestore layout (all small text; the big source PDFs never go here, see sw.js):
//   binder/outline     { json }                 the folder list (what src/data/outline.json was)
//   binder/meta        { seeded, by }           set once the site's lessons were first copied in
//   lessons/<slug ~>   { slug, title, mdx, base, html, at, by }
//                      mdx = the lesson's source, html = the page as shown, base = the mdx that html's
//                      data-src offsets point into (the editor patches changed blocks into mdx with them)
//   texts/<path ~>     { path, text }           any other file the app keeps (e.g. the Notion sync map)
//   files/<path ~>     { type, n, d }           pictures and files added in the editor (base64, split in
//                      files/<id>/parts/<i> { d } when bigger than one document holds)
// "~" stands for "/" (Firestore ids can't hold slashes). Only the owner's Google account can read or write
// any of it (firestore.rules); scripts/binder.mjs is how Claude reads and writes it with a service account.
import cfgFile from '../data/firebase.json';
import type { Firestore, DocumentReference } from 'firebase/firestore';
import type { User } from 'firebase/auth';

type Cfg = { apiKey: string; authDomain: string; projectId: string; appId: string; signInHosts?: string[] };
const envCfg = import.meta.env.PUBLIC_FIREBASE_CONFIG as string | undefined;
export const config: Cfg = envCfg ? JSON.parse(envCfg) : (cfgFile as Cfg);
export const cloudOn = !!config.projectId;
// Local testing only (npm run build with PUBLIC_FIREBASE_EMULATOR=127.0.0.1): use the Firebase emulators.
const emu = import.meta.env.PUBLIC_FIREBASE_EMULATOR as string | undefined;

const base = document.body.dataset.base || '/';
type FS = typeof import('firebase/firestore');
type Ctx = { fs: FS; db: Firestore; email: string };
export const idOf = (p: string) => p.replace(/\//g, '~');
export const OUTLINE = 'src/data/outline.json';
const LESSON = /^src\/content\/lessons\/(.+)\.mdx?$/;
const UPLOAD = /^public\/(uploads\/.+)$/;

/* ---------- sign-in ---------- */
// iPad, iPhone and Safari keep a site's sign-in apart from Google's firebaseapp.com page, so Google's answer never
// comes back to the binder and you land on the sign-in page again. There, sign-in goes through the binder's own
// address instead (/__/auth, which vercel.json hands to Firebase), as a full-page trip to Google and back.
const ua = navigator.userAgent;
export const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(ua));
const sameSite = !emu && apple && (config.signInHosts || []).includes(location.host);
let fbP: Promise<{ auth: import('firebase/auth').Auth; A: typeof import('firebase/auth'); app: import('firebase/app').FirebaseApp }> | null = null;
export const firebase = () => (fbP ??= (async () => {
  const [{ initializeApp }, A] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = initializeApp({ apiKey: config.apiKey, authDomain: sameSite ? location.host : config.authDomain, projectId: config.projectId, appId: config.appId });
  const auth = A.getAuth(app);
  if (emu) A.connectAuthEmulator(auth, `http://${emu}:9099`, { disableWarnings: true });
  // Tests sign in without Google's window (the emulator takes a made-up Google account).
  if (emu) (window as any).__testSignIn = (email: string) => A.signInWithCredential(auth, A.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));
  return { app, A, auth };
})());

/** The signed-in Google account on this device, once Firebase has checked (null when signed out). */
export async function currentUser(): Promise<User | null> {
  const { auth } = await firebase();
  await auth.authStateReady();
  return auth.currentUser;
}
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const REDIRECTING = 'cfi.gRedirect';
/** Google's sign-in window (a full-page trip to Google and back in the home-screen app and on Apple devices). */
export async function signInWithGoogle(): Promise<User | null> {
  const { auth, A } = await firebase();
  const p = new A.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  const away = async () => { try { sessionStorage.setItem(REDIRECTING, String(Date.now())); } catch {} await A.signInWithRedirect(auth, p); return null; };
  if (sameSite || standalone()) return away();
  try { return (await A.signInWithPopup(auth, p)).user; }
  catch (e: any) {
    if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(e?.code || '')) return away();
    throw e;
  }
}
/** Back from a redirect sign-in: the account, if that's what just happened. */
export async function redirectUser(): Promise<User | null> {
  const { auth, A } = await firebase();
  try { return (await A.getRedirectResult(auth))?.user || null; }
  catch (e: any) { console.warn('redirect sign-in', e); throw e; }
}
/** Show the binder's server who you are; it checks the account with Firestore and sets the sign-in cookie. */
export async function serverSignIn(user: User) {
  const r = await fetch(`${base}api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: await user.getIdToken() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Couldn’t sign in. Try again.');
  await clearPages();
}
/** Saved copies of the site's pages (sw.js): dropped when you sign in or out, so the next page is the right one. */
export const clearPages = () => (self.caches ? caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('cfi-binder-')).map((k) => caches.delete(k)))).catch(() => {}) : Promise.resolve());
export async function signOutEverywhere() {
  try { const { auth, A } = await firebase(); await A.signOut(auth); } catch {}
  try { Object.keys(localStorage).filter((k) => k.startsWith('cfi.page.') || k === 'cfi.cloudEdited' || k === 'cfi.seeded').forEach((k) => localStorage.removeItem(k)); } catch {}
  await clearPages();
  location.href = `${base}api/login?out=1`;
}

/* ---------- the database ---------- */
let ctxP: Promise<Ctx | null> | null = null;
/** Firestore for the signed-in owner (null when cloud sync isn't set up or nobody's signed in). */
export const cloud = () => (ctxP ??= (async () => {
  if (!cloudOn) return null;
  const user = await currentUser();
  if (!user) return null;
  const [fs, { app }] = await Promise.all([import('firebase/firestore'), firebase()]);
  let db: Firestore;
  try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch { db = fs.getFirestore(app); }
  if (emu) fs.connectFirestoreEmulator(db, emu, 8080);
  return { fs, db, email: user.email || '' };
})());
const need = async () => { const c = await cloud(); if (!c) throw new Error('Sign in with Google to save.'); return c; };
const ref = (c: Ctx, path: string) => c.fs.doc(c.db, path) as DocumentReference;

// The newest copy of each document this page has seen (from a live listener or our own writes).
const mem = new Map<string, any>();

/* ---------- sync state: Saved here → Synced ---------- */
let inflight = 0, lastError = '';
const emit = () => window.dispatchEvent(new CustomEvent('cfi:sync', { detail: { inflight, error: lastError } }));
export const syncState = () => ({ inflight, error: lastError });
/** Don't wait for the server (offline it never answers): the write is already in this device's copy. */
function track(p: Promise<unknown>) {
  inflight++; emit();
  p.then(() => { lastError = ''; }, (e) => { lastError = e?.code === 'permission-denied' ? 'This Google account can’t write to the binder.' : String(e?.message || e); console.error(e); })
    .finally(() => { inflight--; emit(); });
}

/** Read a document: what a live listener has, else the server, else this device's copy (offline). */
export async function read(path: string): Promise<any | null | undefined> {
  if (mem.has(path)) return mem.get(path);
  const c = await cloud(); if (!c) return undefined;
  try { const s = await c.fs.getDoc(ref(c, path)); const d = s.exists() ? s.data() : null; mem.set(path, d); return d; }
  catch { try { const s = await c.fs.getDocFromCache(ref(c, path)); return s.exists() ? s.data() : null; } catch { return undefined; } }
}
/** Keep a document live: cb runs now (from this device's copy when there is one) and on every change. */
export async function watch(path: string, cb: (d: any | null, m: { local: boolean; cache: boolean }) => void) {
  const c = await cloud(); if (!c) return () => {};
  return c.fs.onSnapshot(ref(c, path), (s) => {
    const d = s.exists() ? s.data() : null;
    mem.set(path, d);
    cb(d, { local: s.metadata.hasPendingWrites, cache: s.metadata.fromCache });
  }, (e) => console.error(path, e));
}
function put(c: Ctx, path: string, data: Record<string, unknown>) {
  const d = { ...(mem.get(path) || {}), ...data };
  mem.set(path, d);
  track(c.fs.setDoc(ref(c, path), data, { merge: true }));
}
function drop(c: Ctx, path: string) { mem.set(path, null); track(c.fs.deleteDoc(ref(c, path))); }

let builtSlugs: Set<string> | null = null;
/** Where a page opens: its own address when the site was built with it, else the page that fills itself from Firestore. */
export function hrefOf(slug: string) {
  builtSlugs ??= new Set(JSON.parse(document.getElementById('built-slugs')?.textContent || '[]'));
  return !cloudOn || builtSlugs.has(slug) ? `${base}${slug}/` : `${base}draft/?p=${encodeURIComponent(slug)}`;
}
export const lessonPath = (slug: string) => `lessons/${idOf(slug)}`;
const titleOf = (mdx: string) => { const m = mdx.match(/^title:[ \t]*(.*)$/m); if (!m) return ''; try { return JSON.parse(m[1]); } catch { return m[1].replace(/^'(.*)'$/, '$1').trim(); } };

/** A file the app used to send to GitHub, as text (null when it isn't in the binder). */
export async function readText(path: string): Promise<string | null | undefined> {
  if (path === OUTLINE) { const d = await read('binder/outline'); return d === undefined ? undefined : d?.json ?? null; }
  const l = path.match(LESSON);
  if (l) { const d = await read(lessonPath(l[1])); return d === undefined ? undefined : d?.mdx ?? null; }
  const d = await read(`texts/${idOf(path)}`); return d === undefined ? undefined : d?.text ?? null;
}
/** What we know of a document without waiting long: this page's copy, the device's copy, else a quick look at the server. */
async function known(c: Ctx, path: string): Promise<any | null | undefined> {
  if (mem.has(path)) return mem.get(path);
  try { const s = await c.fs.getDocFromCache(ref(c, path)); if (s.exists()) return s.data(); } catch {}
  const net = c.fs.getDoc(ref(c, path)).then((s) => (s.exists() ? s.data() : null), () => undefined);
  return Promise.race([net, new Promise<undefined>((ok) => setTimeout(() => ok(undefined), 2500))]);
}
/** Before leaving the page: give the last writes a moment to reach the server (they're safe on the device either way). */
export async function settle(ms = 1500) {
  const c = await cloud(); if (!c) return;
  await Promise.race([c.fs.waitForPendingWrites(c.db).catch(() => {}), new Promise((ok) => setTimeout(ok, ms))]);
}
const PART = 900_000; // characters of base64 per document (a document holds up to 1 MB)
/** Save files (what used to be one GitHub commit). Text, { base64 } for a picture, or null to delete. */
export async function writeFiles(files: { path: string; content: string | { base64: string } | null }[]) {
  const c = await need();
  const at = Date.now(), by = c.email;
  for (const f of files) {
    if (f.path === OUTLINE) { if (typeof f.content === 'string') put(c, 'binder/outline', { json: f.content, at, by }); continue; }
    const l = f.path.match(LESSON);
    if (l) {
      const p = lessonPath(l[1]);
      if (f.content === null) { drop(c, p); continue; }
      const mdx = String(f.content), cur = await known(c, p);
      // base is set once, when the page is new (or came in with its page already shown, e.g. from Notion).
      put(c, p, { slug: l[1], mdx, title: titleOf(mdx), at, by, ...(cur === undefined || cur?.base ? {} : { base: mdx }) });
      continue;
    }
    const u = f.path.match(UPLOAD);
    if (u) {
      const p = `files/${idOf(u[1])}`;
      if (f.content === null) { drop(c, p); continue; }
      const b64 = typeof f.content === 'string' ? btoa(unescape(encodeURIComponent(f.content))) : f.content.base64;
      const type = typeMap[(u[1].split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
      const n = Math.ceil(b64.length / PART) || 1;
      if (n === 1) put(c, p, { type, n, d: b64, at });
      else {
        for (let i = 0; i < n; i++) track(c.fs.setDoc(ref(c, `${p}/parts/${i}`), { d: b64.slice(i * PART, (i + 1) * PART) }));
        put(c, p, { type, n, at });
      }
      continue;
    }
    const p = `texts/${idOf(f.path)}`;
    if (f.content === null) drop(c, p); else put(c, p, { path: f.path, text: typeof f.content === 'string' ? f.content : f.content.base64, at });
  }
}
const typeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', txt: 'text/plain' };

/** The page as shown. */
export async function saveHtml(slug: string, html: string) {
  const c = await need();
  if (html.length > PART) throw new Error('This page is too big to save. Split it into two pages.');
  put(c, lessonPath(slug), { slug, html, at: Date.now(), by: c.email });
}
/** The source was edited by hand: the page needs rendering again (scripts/binder.mjs render). */
export async function markStale(slug: string) { const c = await need(); put(c, lessonPath(slug), { stale: true }); }
export async function lesson(slug: string) { return read(lessonPath(slug)); }

/* ---------- pictures and files added in the editor ---------- */
const blobs = new Map<string, Promise<string | null>>();
async function fileUrl(name: string) {
  const c = await cloud(); if (!c) return null;
  const p = `files/${idOf(name)}`;
  const d = await read(p);
  if (!d) return null;
  let b64 = d.d || '';
  if (!b64 && d.n > 1) for (let i = 0; i < d.n; i++) b64 += (await read(`${p}/parts/${i}`))?.d || '';
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: d.type || 'application/octet-stream' }));
}
/** Point pictures, audio and file links that live in the binder (…/uploads/…) at their saved copies. */
export function showUploads(root: ParentNode) {
  if (!cloudOn) return;
  const at = `${base}uploads/`;
  root.querySelectorAll<HTMLElement>('img[src], audio[src], source[src], a[href]').forEach((el) => {
    const k = el.hasAttribute('src') ? 'src' : 'href';
    const v = el.getAttribute(k) || '';
    let path = '';
    try { const u = new URL(v, location.href); if (u.origin === location.origin && u.pathname.startsWith(at)) path = decodeURIComponent(u.pathname.slice(base.length)); } catch {}
    if (!path) return;
    if (!blobs.has(path)) blobs.set(path, fileUrl(path).catch(() => null));
    blobs.get(path)!.then((url) => { if (url) { el.dataset.upPath = v; el.setAttribute(k, url); } });
  });
}

/* ---------- first time: copy the site's lessons in; carry over anything waiting for Upload ---------- */
let readyP: Promise<boolean> | null = null;
/** Signed in and the binder is in Firestore (copies the built lessons in the very first time). */
export const ready = () => (readyP ??= (async () => {
  const c = await cloud(); if (!c) return false;
  try {
    const meta = await c.fs.getDoc(ref(c, 'binder/meta'));
    if (!meta.exists()) await seed(c);
  } catch (e) { console.warn('Couldn’t check the binder in Firestore (offline?)', e); }
  return true;
})());
async function seed(c: Ctx) {
  const from = new URL(base, location.href);
  const outline = await fetch(new URL('source/outline.json', from), { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('outline'); return r.text(); });
  const { pagesIn } = await import('../data/tree');
  const slugs = pagesIn(JSON.parse(outline).areas).map((p) => p.slug).filter(Boolean) as string[];
  const b = c.fs.writeBatch(c.db), at = Date.now(), by = c.email;
  b.set(ref(c, 'binder/outline'), { json: outline, at, by });
  for (const slug of slugs) {
    const [mdx, page] = await Promise.all([
      fetch(new URL(`source/${slug}.txt`, from), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')),
      fetch(new URL(`${slug}/`, from), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')),
    ]);
    if (!mdx) continue;
    const html = new DOMParser().parseFromString(page, 'text/html').querySelector('[data-article]')?.innerHTML || '';
    b.set(ref(c, lessonPath(slug)), { slug, title: titleOf(mdx), mdx, base: mdx, html, at, by });
  }
  b.set(ref(c, 'binder/meta'), { seeded: at, by });
  await b.commit();
  mem.clear();
}
