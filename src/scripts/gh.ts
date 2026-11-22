// Talking to the binder's GitHub repo. The key is saved once to the binder (api/gh.js keeps it on the server,
// encrypted), so every device you're signed in on can upload. A device that already had a key saves it there by
// itself; without the server copy, the key on this device is used directly. Every change is one commit; the
// site rebuilds about 2 minutes later.
export const repo = document.body.dataset.repo || 'Frenchbear1/CFI-Binder';
const TOKEN = 'cfi.ghToken';
export const token = () => { try { return localStorage.getItem(TOKEN) || ''; } catch { return ''; } };
export const forgetToken = () => { try { localStorage.removeItem(TOKEN); } catch {} };

const API = (document.body.dataset.base || '/') + 'api/gh';
let server: Promise<boolean> | null = null;
/** Is a key saved on the server (so this device needs none)? */
export const serverKey = (fresh = false) => (server = !fresh && server ? server : fetch(API, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { ready: false })).then((j) => !!j.ready).catch(() => false));
async function saveServerKey(t: string) {
  const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'key', token: t }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error && j.error.length > 8 ? j.error : 'Couldn’t save the key to your binder.');
  server = Promise.resolve(true);
}
/** A device that already has a key: put it on the server once, so other devices can upload too. */
export async function syncKey() {
  const t = token();
  if (!t || document.body.classList.contains('guest') || (await serverKey())) return;
  try { await saveServerKey(t); } catch {}
}

export async function gh(path: string, init: RequestInit = {}) {
  if (await serverKey()) {
    return fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'call', path, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : null }) });
  }
  return fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token()}`, ...(init.headers || {}) },
  });
}
const keyErr = () => Object.assign(new Error('key'), { key: true });
async function ok(r: Response, what: string) {
  if (r.status === 401 || r.status === 403 || r.status === 409) throw keyErr();
  if (!r.ok) throw new Error(`${what}: GitHub said ${r.status}`);
  return r.json();
}
export const b64decode = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
export const b64encode = (t: string) => { let s = ''; new TextEncoder().encode(t).forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };

/** A file's current text on main (null if it doesn't exist). */
export async function readFile(path: string): Promise<{ text: string; sha: string } | null> {
  const r = await gh(`contents/${path}?ref=main&t=${Date.now()}`);
  if (r.status === 404) return null;
  const j = await ok(r, 'Reading ' + path);
  return { text: b64decode(j.content), sha: j.sha };
}

/** Commit several files at once. content: text, or { base64 } for binary; null deletes the file. */
export async function commitFiles(files: { path: string; content: string | { base64: string } | null }[], message: string) {
  const ref = await ok(await gh(`git/ref/heads/main?t=${Date.now()}`), 'Reading main');
  const head = await ok(await gh(`git/commits/${ref.object.sha}`), 'Reading the last commit');
  const tree = [];
  for (const f of files) {
    if (f.content === null) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const body = typeof f.content === 'string' ? { content: b64encode(f.content), encoding: 'base64' } : { content: f.content.base64, encoding: 'base64' };
    const blob = await ok(await gh('git/blobs', { method: 'POST', body: JSON.stringify(body) }), 'Uploading ' + f.path);
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const t = await ok(await gh('git/trees', { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) }), 'Building the change');
  const c = await ok(await gh('git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) }), 'Making the commit');
  const r = await gh('git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  if (r.status === 422) throw new Error('Something else changed the binder at the same moment. Try again.');
  await ok(r, 'Saving');
  return c.sha as string;
}

/** Ask for the token once (the "Connect your binder" sheet), then carry on. */
export function needKey(then: () => void) {
  const dlg = document.getElementById('sheet-token') as HTMLDialogElement | null;
  if (!dlg) return;
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
  dlg.showModal();
  dlg.querySelector<HTMLInputElement>('[data-token-input]')!.focus();
  const form = dlg.querySelector<HTMLFormElement>('[data-token-form]')!;
  const note = dlg.querySelector<HTMLElement>('[data-token-note]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const inp = dlg.querySelector<HTMLInputElement>('[data-token-input]')!;
    const v = inp.value.trim();
    if (!v) return;
    if (note) note.textContent = 'Checking the key…';
    try { await saveServerKey(v); }
    catch (err: any) {
      // The server couldn't keep it (or GitHub refused it): keep it on this device, as before.
      if (/accept|look like/.test(err.message)) { if (note) note.textContent = err.message; return; }
      try { localStorage.setItem(TOKEN, v); } catch {}
    }
    inp.value = ''; if (note) note.textContent = '';
    dlg.close();
    then();
  };
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
}

/** Run a GitHub action, asking for (or replacing) the token when needed. */
export async function withKey<T>(run: () => Promise<T>, retry: () => void): Promise<T | undefined> {
  await syncKey();
  if (!(await serverKey()) && !token()) { needKey(retry); return; }
  try { return await run(); }
  catch (e: any) { if (e.key) { forgetToken(); server = Promise.resolve(false); needKey(retry); return; } throw e; }
}

export const kebab = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';
