// Home page, laid out like Notion's: folders (areas) you can open and close, recent pages, a search bar
// at the bottom and a compose button that makes a new page or folder. New pages and folders are written
// to the binder's GitHub repo in one commit (outline.json + the lesson file); the site rebuilds in ~2 min.
import { commitFiles, readFile, withKey, kebab } from './gh';

type Topic = { title: string; slug?: string; levels: string[] };
type Area = { title: string; topics: Topic[] };
type Pending = { kind: 'page' | 'folder'; title: string; area: string; slug?: string; at: number };

const base = document.body.dataset.base || '/';
const outline: Area[] = JSON.parse(document.getElementById('outline-data')?.textContent || '[]');
const tree = document.querySelector<HTMLElement>('[data-tree]')!;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const store = {
  get<T>(k: string, d: T): T { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const PAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>';
const FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

/* ---------- folders remember whether they're open ---------- */
const folds = store.get<Record<string, boolean>>('cfi.folds', {});
const fold = (title: string) => [...tree.querySelectorAll<HTMLDetailsElement>('details.fold')].find((d) => d.dataset.fold === title);
tree.querySelectorAll<HTMLDetailsElement>('details.fold').forEach((d) => {
  if (d.dataset.fold! in folds) d.open = folds[d.dataset.fold!];
  d.addEventListener('toggle', () => { folds[d.dataset.fold!] = d.open; store.set('cfi.folds', folds); });
});

/* ---------- a short note left by another page (e.g. "Deleted …") ---------- */
const notice = document.querySelector<HTMLElement>('[data-notice]')!;
function toast(t: string) { notice.textContent = t; notice.hidden = false; }
try { const n = localStorage.getItem('cfi.notice'); if (n) { toast(n); localStorage.removeItem('cfi.notice'); } } catch {}

/* ---------- recents ---------- */
{
  const live = new Map(outline.flatMap((a) => a.topics.filter((t) => t.slug).map((t) => [t.slug!, { t, a }])));
  const rec = store.get<{ slug: string; title?: string; area?: string }[]>('cfi.recent', []).filter((r) => live.has(r.slug)).slice(0, 8);
  if (rec.length) {
    document.querySelector<HTMLElement>('[data-recents]')!.hidden = false;
    document.querySelector<HTMLElement>('[data-recent-cards]')!.innerHTML = rec.map((r) => {
      const { t, a } = live.get(r.slug)!;
      return `<a class="nh-card" href="${base}${r.slug}/"><span class="ico">${PAGE}</span><b>${esc(t.title)}</b><small>${esc(a.title)}</small></a>`;
    }).join('');
  }
}

/* ---------- pages and folders still being published ---------- */
const known = new Set(outline.flatMap((a) => a.topics.map((t) => t.slug).filter(Boolean)));
const knownAreas = new Set(outline.map((a) => a.title));
let pending = store.get<Pending[]>('cfi.pending', []).filter((p) => Date.now() - p.at < 20 * 60e3 && (p.kind === 'page' ? !known.has(p.slug) : !knownAreas.has(p.title)));
store.set('cfi.pending', pending);

function folderEl(title: string): HTMLDetailsElement {
  let d = fold(title);
  if (d) return d;
  d = document.createElement('details');
  d.className = 'fold'; d.dataset.fold = title; d.open = true;
  d.innerHTML = `<summary><span class="chev" aria-hidden="true"></span><span class="ico">${FOLDER}</span><span class="fold-t">${esc(title)}</span><span class="fold-n">Publishing…</span><button type="button" class="fold-add" data-new-in="${esc(title)}" aria-label="New page here">+</button></summary><ul><li class="pg-empty">No pages yet</li></ul>`;
  tree.append(d);
  return d;
}
function showPending(p: Pending) {
  const d = folderEl(p.kind === 'folder' ? p.title : p.area);
  if (p.kind === 'folder') return;
  d.open = true;
  const ul = d.querySelector('ul')!;
  ul.querySelector('.pg-empty')?.remove();
  const planned = [...ul.querySelectorAll<HTMLElement>('[data-plan]')].find((b) => b.dataset.plan === p.title);
  const li = planned?.closest('li') || ul.appendChild(document.createElement('li'));
  li.removeAttribute('data-for');
  li.innerHTML = `<span class="pg building"><span class="ico">${PAGE}</span><span class="pg-t">${esc(p.title)}</span><small>Publishing…</small></span>`;
}
pending.forEach(showPending);
// Check back while something is publishing, and swap in the live link once the page is up.
if (pending.length) {
  const tick = window.setInterval(async () => {
    for (const p of pending.filter((x) => x.kind === 'page')) {
      const r = await fetch(`${base}${p.slug}/`, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
      if (r?.ok) {
        const el = [...tree.querySelectorAll<HTMLElement>('.building')].find((b) => b.querySelector('.pg-t')?.textContent === p.title);
        if (el) el.outerHTML = `<a class="pg" href="${base}${p.slug}/"><span class="ico">${PAGE}</span><span class="pg-t">${esc(p.title)}</span><small class="is-new">New</small></a>`;
        pending = pending.filter((x) => x !== p); store.set('cfi.pending', pending);
      }
    }
    if (!pending.some((x) => x.kind === 'page')) clearInterval(tick);
  }, 20000);
}

/* ---------- compose button: New page / New folder ---------- */
const compose = document.querySelector<HTMLButtonElement>('[data-compose]')!;
const menu = document.querySelector<HTMLElement>('[data-compose-menu]')!;
const setMenu = (v: boolean) => { menu.hidden = !v; compose.setAttribute('aria-expanded', String(v)); };
compose.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target as Node)) setMenu(false); });

const dlg = document.getElementById('sheet-new') as HTMLDialogElement;
const form = dlg.querySelector<HTMLFormElement>('[data-new-form]')!;
const titleIn = form.querySelector<HTMLInputElement>('[data-new-title]')!;
const areaSel = form.querySelector<HTMLSelectElement>('[data-new-area]')!;
const note = form.querySelector<HTMLElement>('[data-new-note]')!;
const go = form.querySelector<HTMLButtonElement>('[data-new-go]')!;
const NOTE = 'It’s saved to your binder and goes live in about 2 minutes.';
let mode: 'page' | 'folder' = 'page';
let fromPlan = '';

function openNew(kind: 'page' | 'folder', opts: { title?: string; area?: string; levels?: string[]; plan?: boolean } = {}) {
  setMenu(false);
  mode = kind; fromPlan = opts.plan ? opts.title || '' : '';
  form.querySelector<HTMLElement>('[data-new-h]')!.textContent = kind === 'folder' ? 'New folder' : opts.plan ? 'Start this page' : 'New page';
  form.querySelector<HTMLElement>('[data-page-only]')!.hidden = kind === 'folder';
  titleIn.placeholder = kind === 'folder' ? 'Folder name' : 'Untitled';
  titleIn.value = opts.title || '';
  // Folders made earlier on this device may not be in the built list yet.
  for (const p of pending) if (p.kind === 'folder' && ![...areaSel.options].some((o) => o.value === p.title)) areaSel.add(new Option(p.title, p.title));
  if (opts.area) areaSel.value = opts.area;
  const lv = opts.levels?.length ? opts.levels : ['pa', 'ir', 'ca'];
  form.querySelectorAll<HTMLInputElement>('input[name="lv"]').forEach((c) => (c.checked = lv.includes(c.value)));
  note.textContent = NOTE; note.dataset.kind = '';
  go.disabled = false; go.textContent = 'Create';
  dlg.showModal();
  setTimeout(() => { titleIn.focus(); titleIn.select(); }, 50);
}
menu.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-new]');
  if (b) openNew(b.dataset.new as 'page' | 'folder');
});
tree.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const add = t.closest<HTMLElement>('[data-new-in]');
  if (add) { e.preventDefault(); openNew('page', { area: add.dataset.newIn }); return; }
  const plan = t.closest<HTMLElement>('[data-plan]');
  if (plan) openNew('page', { title: plan.dataset.plan, area: plan.dataset.area, levels: plan.dataset.levels!.split(' '), plan: true });
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
dlg.querySelector('[data-close]')!.addEventListener('click', () => dlg.close());

const yaml = (t: string) => JSON.stringify(t);
const lessonFile = (o: { title: string; area: string; levels: string[] }) => `---
title: ${yaml(o.title)}
summary: ""
area: ${yaml(o.area)}
levels: [${o.levels.join(', ')}]
order: 0
updated: ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
---

Start writing here. Tap the pencil to edit, and type / to add any block.
`;

async function create() {
  const title = titleIn.value.replace(/\s+/g, ' ').trim();
  if (!title) { titleIn.focus(); return; }
  const levels = [...form.querySelectorAll<HTMLInputElement>('input[name="lv"]:checked')].map((c) => c.value);
  if (mode === 'page' && !levels.length) { note.textContent = 'Pick at least one level.'; note.dataset.kind = 'err'; return; }
  const area = areaSel.value;
  go.disabled = true; go.textContent = 'Saving…'; note.dataset.kind = '';
  try {
    const done = await withKey(async () => {
      const o = await readFile('src/data/outline.json');
      if (!o) throw new Error('Couldn’t find the binder’s folder list');
      const data: { areas: Area[] } = JSON.parse(o.text);
      if (mode === 'folder') {
        if (data.areas.some((a) => a.title.toLowerCase() === title.toLowerCase())) throw new Error('There’s already a folder with that name.');
        data.areas.push({ title, topics: [] });
        await commitFiles([{ path: 'src/data/outline.json', content: JSON.stringify(data, null, 2) + '\n' }], `Add folder “${title}” in the binder`);
        return { kind: 'folder' as const, title, area: title };
      }
      let a = data.areas.find((x) => x.title === area);
      if (!a) { a = { title: area, topics: [] }; data.areas.push(a); }
      // The folder's directory: wherever its existing pages live, else its name in kebab-case.
      const dir = a.topics.find((t) => t.slug)?.slug!.split('/')[0] || kebab(area);
      const taken = new Set(data.areas.flatMap((x) => x.topics.map((t) => t.slug)));
      let slug = `${dir}/${kebab(title)}`;
      for (let n = 2; taken.has(slug); n++) slug = `${dir}/${kebab(title)}-${n}`;
      const plannedTopic = a.topics.find((t) => !t.slug && t.title === (fromPlan || title));
      if (plannedTopic) { plannedTopic.slug = slug; plannedTopic.title = title; plannedTopic.levels = levels; }
      else a.topics.push({ title, slug, levels });
      await commitFiles([
        { path: `src/content/lessons/${slug}.mdx`, content: lessonFile({ title, area, levels }) },
        { path: 'src/data/outline.json', content: JSON.stringify(data, null, 2) + '\n' },
      ], `Add page “${title}” to ${area}`);
      return { kind: 'page' as const, title, area, slug };
    }, create);
    if (!done) { go.disabled = false; go.textContent = 'Create'; return; }
    const p: Pending = { ...done, at: Date.now() };
    pending.push(p); store.set('cfi.pending', pending);
    if (done.kind === 'folder' && ![...areaSel.options].some((x) => x.value === done.title)) areaSel.add(new Option(done.title, done.title));
    showPending(p);
    dlg.close();
    toast(done.kind === 'folder' ? `Folder “${done.title}” added. Add a page to it with +.` : `“${done.title}” is saved. It goes live in about 2 minutes, then tap it to start writing.`);
  } catch (err: any) {
    note.textContent = err.message || String(err); note.dataset.kind = 'err';
    go.disabled = false; go.textContent = 'Create';
  }
}
form.addEventListener('submit', (e) => { e.preventDefault(); create(); });
