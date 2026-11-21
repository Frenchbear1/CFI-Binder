// Talking to the binder's GitHub repo from the browser, with David's fine-grained token (kept on this
// device only). Every change is one commit; GitHub Pages rebuilds the site about 2 minutes later.
export const repo = document.body.dataset.repo || 'Frenchbear1/CFI-Binder';
const TOKEN = 'cfi.ghToken';
export const token = () => { try { return localStorage.getItem(TOKEN) || ''; } catch { return ''; } };
export const forgetToken = () => { try { localStorage.removeItem(TOKEN); } catch {} };

export const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com/repos/${repo}/${path}`, {
  ...init, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token()}`, ...(init.headers || {}) },
});
const keyErr = () => Object.assign(new Error('key'), { key: true });
async function ok(r: Response, what: string) {
  if (r.status === 401 || r.status === 403) throw keyErr();
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
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = dlg.querySelector<HTMLInputElement>('[data-token-input]')!.value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN, v); } catch {}
    dlg.close();
    then();
  };
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
}

/** Run a GitHub action, asking for (or replacing) the token when needed. */
export async function withKey<T>(run: () => Promise<T>, retry: () => void): Promise<T | undefined> {
  if (!token()) { needKey(retry); return; }
  try { return await run(); }
  catch (e: any) { if (e.key) { forgetToken(); needKey(retry); return; } throw e; }
}

export const kebab = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';
