// Changes made in the app stay on this device until you tap Upload on the home page.
// Everything lives in IndexedDB (asked to be persistent, so the browser won't clear it to free space):
//   file:<repo path>  → the file's new text, { base64 } for a picture, or null to delete it
//   page:<slug>       → the edited lesson as it looks on screen, shown instead of the live copy until uploaded
//   new:<slug>        → a page made on this device that isn't on the site yet
// A small index in localStorage lets pages know straight away (before the database answers) what's waiting.
//
// Once the binder has a Firebase project (src/data/firebase.json), all of this goes to Firestore instead
// (cloud.ts): every save syncs to your other devices by itself and there's no Upload. Anything still waiting
// here from before is carried over the first time this device signs in with Google (migrateLegacy).
import { commitFiles } from './gh';
import * as C from './cloud';
const cloudOn = C.cloudOn;

export type Content = string | { base64: string } | null;
export type LocalPage = { slug: string; title: string; area: string; levels: string[]; at: number };
type Index = { files: string[]; pages: string[]; news: LocalPage[]; folders: string[]; notes: string[] };

const IDX = 'cfi.outbox';
const base = document.body.dataset.base || '/';
let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open('cfi-binder', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void): Promise<T> => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('kv', mode);
    const req = run(t.objectStore('kv'));
    t.oncomplete = () => res(req ? (req as IDBRequest).result : undefined);
    t.onerror = () => rej(t.error);
  });
};
const get = <T>(k: string) => tx<T | undefined>('readonly', (s) => s.get(k));
const put = (k: string, v: unknown) => tx<void>('readwrite', (s) => { s.put(v, k); });
const del = (k: string) => tx<void>('readwrite', (s) => { s.delete(k); });

export function index(): Index {
  if (cloudOn) return { files: [], pages: [], news: [], folders: [], notes: [] };
  return legacyIndex();
}
function legacyIndex(): Index {
  let i: Partial<Index> = {};
  try { i = JSON.parse(localStorage.getItem(IDX) || '{}'); } catch {}
  return { files: i.files || [], pages: i.pages || [], news: i.news || [], folders: i.folders || [], notes: i.notes || [] };
}
const setIndex = (i: Index) => {
  try { localStorage.setItem(IDX, JSON.stringify(i)); } catch {}
  window.dispatchEvent(new CustomEvent('cfi:outbox', { detail: i }));
};
export const waiting = () => { const i = index(); return i.files.length; };

let asked = false;
const keepSafe = () => { if (asked) return; asked = true; navigator.storage?.persist?.().catch(() => {}); };

/** Keep these file changes on the device. note: a few words for the upload's description. */
export async function stage(files: { path: string; content: Content }[], note: string, extra: Partial<Pick<Index, 'news' | 'folders'>> = {}) {
  if (cloudOn) return C.writeFiles(files);
  keepSafe();
  for (const f of files) await put('file:' + f.path, { content: f.content, at: Date.now() });
  const i = index();
  for (const f of files) if (!i.files.includes(f.path)) i.files.push(f.path);
  if (note && !i.notes.includes(note)) i.notes.push(note);
  for (const n of extra.news || []) { i.news = i.news.filter((x) => x.slug !== n.slug); i.news.push(n); }
  for (const f of extra.folders || []) if (!i.folders.includes(f)) i.folders.push(f);
  setIndex(i);
}

/** A file as it stands with your changes: the staged copy, else the copy the site was built from. */
export async function readLocal(path: string): Promise<string | null> {
  if (cloudOn) { const t = await C.readText(path); if (t != null) return t; }
  const s = cloudOn ? undefined : await get<{ content: Content }>('file:' + path);
  if (s) return typeof s.content === 'string' ? s.content : null;
  const url = path === 'src/data/outline.json' ? 'source/outline.json'
    : path.startsWith('src/content/lessons/') ? `source/${path.slice(20).replace(/\.mdx?$/, '')}.txt` : '';
  if (!url) return null;
  const r = await fetch(new URL(url, new URL(base, document.baseURI)), { cache: 'no-cache' }).catch(() => null);
  return r?.ok ? r.text() : null;
}
export const isStaged = (path: string) => cloudOn || index().files.includes(path);

/** The edited lesson, as shown on screen. */
export async function savePage(slug: string, html: string) {
  if (cloudOn) return C.saveHtml(slug, html);
  await put('page:' + slug, { html, at: Date.now() });
  const i = index();
  if (!i.pages.includes(slug)) { i.pages.push(slug); setIndex(i); }
}
export const loadPage = async (slug: string): Promise<string | null> => (cloudOn ? (await C.lesson(slug))?.html ?? null : (await get<{ html: string }>('page:' + slug))?.html ?? null);
export const hasPage = (slug: string) => cloudOn || index().pages.includes(slug);

/** Forget a page made on this device (e.g. it was deleted before it was ever uploaded). */
export async function dropPage(slug: string, file: string) {
  if (cloudOn) return C.writeFiles([{ path: file, content: null }]);
  await del('page:' + slug); await del('file:' + file);
  const i = index();
  i.pages = i.pages.filter((x) => x !== slug); i.files = i.files.filter((x) => x !== file); i.news = i.news.filter((x) => x.slug !== slug);
  setIndex(i);
}

/** Send everything waiting to GitHub in one commit, then clear it. */
export async function upload() {
  if (cloudOn) return null;
  const i = index();
  if (!i.files.length) return null;
  const files: { path: string; content: Content }[] = [];
  for (const p of i.files) { const s = await get<{ content: Content }>('file:' + p); if (s) files.push({ path: p, content: s.content }); }
  const msg = i.notes.length === 1 ? i.notes[0] : `Binder changes from the app\n\n${i.notes.map((n) => '- ' + n).join('\n')}`;
  const sha = await commitFiles(files, msg);
  for (const p of i.files) await del('file:' + p);
  // Edited pages keep showing your version until the site has rebuilt with it (about 2 minutes).
  const until = Date.now() + 4 * 60e3;
  for (const s of i.pages) { const v = await get<{ html: string }>('page:' + s); if (v) await put('page:' + s, { ...v, until }); }
  try { localStorage.setItem('cfi.uploaded', JSON.stringify({ at: Date.now(), pages: i.pages, news: i.news, folders: i.folders })); } catch {}
  setIndex({ files: [], pages: i.pages, news: [], folders: [], notes: [] });
  return { sha, count: files.length };
}

/** Once an uploaded page is live, stop showing the device copy. */
export async function expire(slug: string) {
  if (cloudOn) return true;
  const v = await get<{ html: string; until?: number }>('page:' + slug);
  const i = index();
  if (!v || (v.until && Date.now() > v.until)) {
    await del('page:' + slug);
    i.pages = i.pages.filter((x) => x !== slug); setIndex(i);
    return true;
  }
  return false;
}

/** First Google sign-in on this device: send anything that was waiting for Upload to Firestore, then forget it here. */
export async function migrateLegacy() {
  const i = legacyIndex();
  if (!cloudOn || (!i.files.length && !i.pages.length)) return 0;
  const files: { path: string; content: Content }[] = [];
  for (const p of i.files) { const s = await get<{ content: Content }>('file:' + p); if (s) files.push({ path: p, content: s.content }); }
  // Pages made on this device go in first, so their pictures and folder places come with them.
  await C.writeFiles(files);
  for (const slug of i.pages) {
    const v = await get<{ html: string; until?: number }>('page:' + slug);
    if (v?.html && !v.until && i.files.includes(`src/content/lessons/${slug}.mdx`)) await C.saveHtml(slug, v.html);
  }
  for (const p of i.files) await del('file:' + p);
  for (const s of i.pages) await del('page:' + s);
  try { localStorage.removeItem(IDX); localStorage.removeItem('cfi.uploaded'); localStorage.removeItem('cfi.upOutline'); } catch {}
  return files.length;
}
