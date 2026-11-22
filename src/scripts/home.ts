// Home page, laid out like Notion's: folders you can open and close (folders can hold pages and more
// folders, as deep as you like), recent pages, a search bar at the bottom and a compose button that makes
// a new page or folder. Drag a folder or page to move it: onto a folder to put it inside, or between rows
// to reorder. Everything is kept on this device; the Upload button under the folders sends it all to
// GitHub in one commit (the site rebuilds in about 2 minutes).
import { withKey, kebab } from './gh';
import { stage, readLocal, index as outboxIndex, isStaged, upload, type LocalPage } from './outbox';
import interactives from '../data/interactives.json';
import { initNotionImport } from './notion/import';
import { syncToNotion } from './notion/sync';
import { treeHtml, allFolders, nodeAt, listOf, isFolder, pagesIn, foldersOf, type Folder, type Node } from '../data/tree';

type Outline = { _about?: string; areas: Folder[] };
const OUTLINE = 'src/data/outline.json';
const base = document.body.dataset.base || '/';
const built: Folder[] = JSON.parse(document.getElementById('outline-data')?.textContent || '[]');
const tree = document.querySelector<HTMLElement>('[data-tree]')!;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const store = {
  get<T>(k: string, d: T): T { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const PAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>';
const FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

/* ---------- what the folder list looks like on this device ---------- */
// Just uploaded: show the uploaded list until the site has rebuilt with it (pages not live yet say "Publishing…").
let up = store.get<{ at: number; data: Outline } | null>('cfi.upOutline', null);
if (up && (Date.now() - up.at > 15 * 60e3 || JSON.stringify(up.data.areas) === JSON.stringify(built))) { up = null; try { localStorage.removeItem('cfi.upOutline'); } catch {} }
const liveSlugs = new Set(pagesIn(built).map((p) => p.slug).filter(Boolean) as string[]);
let areas: Folder[] = up ? up.data.areas : built;

/** The folder list as it stands with your changes, to change and save. */
async function current(): Promise<Outline> {
  if (!isStaged(OUTLINE) && up) return structuredClone(up.data);
  const o = await readLocal(OUTLINE);
  if (!o) throw new Error('Couldn’t find the binder’s folder list. Check your connection and try again.');
  return JSON.parse(o);
}
const saveOutline = (data: Outline, note: string, files: { path: string; content: string | { base64: string } }[] = [], extra = {}) =>
  stage([...files, { path: OUTLINE, content: JSON.stringify(data, null, 2) + '\n' }], note, extra);

/* ---------- folders remember whether they're open ---------- */
const folds = store.get<Record<string, boolean>>('cfi.folds', {});
const bindFolds = () => tree.querySelectorAll<HTMLDetailsElement>('details.fold').forEach((d) => {
  if (d.dataset.bound) return;
  d.dataset.bound = '1';
  if (d.dataset.fold! in folds) d.open = folds[d.dataset.fold!];
  d.addEventListener('toggle', () => { folds[d.dataset.fold!] = d.open; store.set('cfi.folds', folds); });
});
const openFold = (key: string) => { folds[key] = true; store.set('cfi.folds', folds); };

/* ---------- Interactives: David's sims, one folder, each opens full screen ---------- */
const sims = document.createElement('details');
sims.className = 'fold'; sims.dataset.fold = 'Interactives';
{
  const SIM = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/></svg>';
  sims.innerHTML = `<summary><span class="chev" aria-hidden="true"></span><span class="ico">${FOLDER}</span><span class="fold-t">Interactives</span><span class="fold-n">${interactives.items.length}</span></summary><ul>${interactives.items.map((s) => `<li><a class="pg" href="${base}interactives/${s.id}/"><span class="ico">${SIM}</span><span class="pg-t">${esc(s.name)}</span><small>${esc(s.tag.split(' · ')[0])}</small></a></li>`).join('')}</ul>`;
}

/* ---------- the folder list ---------- */
const isLocal = (slug: string) => outboxIndex().news.some((n) => n.slug === slug);
const pageHref = (slug: string) => (isLocal(slug) ? `${base}draft/?p=${encodeURIComponent(slug)}` : `${base}${slug}/`);
function render() {
  const ix = outboxIndex();
  const edited = new Set(ix.pages.filter((p) => ix.files.includes(`src/content/lessons/${p}.mdx`)));
  const local = new Set(ix.news.map((n) => n.slug));
  tree.innerHTML = treeHtml(areas, {
    base, href: pageHref,
    tag: (s) => (local.has(s) ? 'On this device' : !liveSlugs.has(s) ? 'building' : edited.has(s) ? 'Edited' : ''),
  });
  tree.append(sims);
  bindFolds();
  if (tree.querySelector('.building')) watchPublishing();
}
let watching = 0;
function watchPublishing() {
  if (watching) return;
  watching = window.setInterval(async () => {
    const waiting = [...tree.querySelectorAll<HTMLElement>('.building[data-slug]')].map((b) => b.dataset.slug!);
    if (!waiting.length) { clearInterval(watching); watching = 0; return; }
    let any = false;
    for (const s of waiting) {
      const r = await fetch(`${base}${s}/`, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
      if (r?.ok) { liveSlugs.add(s); any = true; }
    }
    if (any) render();
  }, 20000);
}

/* ---------- a short note left by another page (e.g. "Deleted …") ---------- */
const notice = document.querySelector<HTMLElement>('[data-notice]')!;
function toast(t: string) { notice.textContent = t; notice.hidden = false; }
try { const n = localStorage.getItem('cfi.notice'); if (n) { toast(n); localStorage.removeItem('cfi.notice'); } } catch {}

/* ---------- recents ---------- */
function renderRecents() {
  const live = new Map(pagesIn(areas).filter((t) => t.slug).map((t) => [t.slug!, { title: t.title, where: foldersOf(areas, t.slug!).join(' / ') }]));
  for (const n of outboxIndex().news) if (!live.has(n.slug)) live.set(n.slug, { title: n.title, where: n.area });
  const rec = store.get<{ slug: string }[]>('cfi.recent', []).filter((r) => live.has(r.slug)).slice(0, 8);
  if (!rec.length) return;
  document.querySelector<HTMLElement>('[data-recents]')!.hidden = false;
  document.querySelector<HTMLElement>('[data-recent-cards]')!.innerHTML = rec.map((r) => {
    const t = live.get(r.slug)!;
    return `<a class="nh-card" href="${pageHref(r.slug)}"><span class="ico">${PAGE}</span><b>${esc(t.title)}</b><small>${esc(t.where)}</small></a>`;
  }).join('');
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
const whereSel = form.querySelector<HTMLSelectElement>('[data-new-area]')!;
const note = form.querySelector<HTMLElement>('[data-new-note]')!;
const go = form.querySelector<HTMLButtonElement>('[data-new-go]')!;
const NOTE = 'Saved on this device. Tap Upload on the home page to put it on the site.';
let mode: 'page' | 'folder' = 'page';
let fromPlan = '';

function fillWhere(keep = whereSel.value) {
  const opts = allFolders(areas).map((f) => `<option value="${f.at}">${' '.repeat(f.depth)}${esc(f.title)}</option>`).join('');
  whereSel.innerHTML = (mode === 'folder' ? '<option value="">Top level</option>' : '') + opts;
  whereSel.value = keep;
  if (whereSel.selectedIndex < 0) whereSel.selectedIndex = 0;
}
function setKind(kind: 'page' | 'folder') {
  mode = kind;
  form.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === kind)));
  form.querySelector<HTMLElement>('[data-new-h]')!.textContent = kind === 'folder' ? 'New folder' : fromPlan ? 'Start this page' : 'New page';
  form.querySelector<HTMLElement>('[data-page-only]')!.hidden = kind === 'folder';
  titleIn.placeholder = kind === 'folder' ? 'Folder name' : 'Untitled';
  fillWhere();
}
form.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.addEventListener('click', () => { setKind(b.dataset.kind as 'page' | 'folder'); titleIn.focus(); }));

function openNew(kind: 'page' | 'folder', opts: { title?: string; at?: string; levels?: string[]; plan?: boolean } = {}) {
  setMenu(false);
  fromPlan = opts.plan ? opts.title || '' : '';
  mode = kind; fillWhere(opts.at ?? (kind === 'folder' ? '' : '0'));
  setKind(kind);
  titleIn.value = opts.title || '';
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
  if (add) { e.preventDefault(); openNew('page', { at: add.dataset.newIn }); return; }
  const plan = t.closest<HTMLElement>('[data-plan]');
  if (plan) openNew('page', { title: plan.dataset.plan, at: plan.dataset.in, levels: plan.dataset.levels!.split(' '), plan: true });
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
`;

async function create() {
  const title = titleIn.value.replace(/\s+/g, ' ').trim();
  if (!title) { titleIn.focus(); return; }
  const levels = [...form.querySelectorAll<HTMLInputElement>('input[name="lv"]:checked')].map((c) => c.value);
  if (mode === 'page' && !levels.length) { note.textContent = 'Pick at least one level.'; note.dataset.kind = 'err'; return; }
  const at = whereSel.value;
  go.disabled = true; go.textContent = 'Saving…'; note.dataset.kind = '';
  try {
    const data = await current();
    const parent = at ? nodeAt(data.areas, at) : null;
    if (at && (!parent || !isFolder(parent))) throw new Error('That folder has moved. Pick it again.');
    const list: Node[] = parent ? (parent as Folder).topics : data.areas;
    const path = parent ? allFolders(data.areas).find((f) => f.at === at)!.path : [];
    if (mode === 'folder') {
      if (list.some((n) => isFolder(n) && n.title.toLowerCase() === title.toLowerCase()) || (!parent && title === 'Interactives')) throw new Error('There’s already a folder with that name here.');
      list.push({ title, topics: [] });
      await saveOutline(data, `Add folder “${title}”${path.length ? ` to ${path.join(' / ')}` : ''}`, [], { folders: [[...path, title].join(' / ')] });
      areas = data.areas;
      [...path.keys()].forEach((i) => openFold(path.slice(0, i + 1).join(' / ')));
      render();
      dlg.close();
      tree.querySelector<HTMLElement>(`[data-fold="${CSS.escape([...path, title].join(' / '))}"]`)?.scrollIntoView({ block: 'nearest' });
      toast(`Folder “${title}” added on this device. Use + on it to add pages or more folders.`);
      refreshUpload();
      return;
    }
    if (!parent) throw new Error('Pick a folder for the page.');
    // Pages live in their top folder's directory on GitHub, whichever folder they're shown in.
    const top = data.areas[Number(at.split('.')[0])];
    const dir = pagesIn(top.topics).find((t) => t.slug)?.slug!.split('/')[0] || kebab(top.title);
    const taken = new Set(pagesIn(data.areas).map((t) => t.slug));
    let slug = `${dir}/${kebab(title)}`;
    for (let n = 2; taken.has(slug); n++) slug = `${dir}/${kebab(title)}-${n}`;
    const planned = list.find((t) => !isFolder(t) && !t.slug && t.title === (fromPlan || title));
    if (planned && !isFolder(planned)) { planned.slug = slug; planned.title = title; planned.levels = levels; }
    else list.push({ title, slug, levels });
    const where = path.join(' / ');
    const np: LocalPage = { slug, title, area: where, levels, at: Date.now() };
    await saveOutline(data, `Add page “${title}” to ${where}`, [{ path: `src/content/lessons/${slug}.mdx`, content: lessonFile({ title, area: where, levels }) }], { news: [np] });
    // Straight into the new page, like Notion.
    location.href = `${base}draft/?p=${encodeURIComponent(slug)}&new=1`;
  } catch (err: any) {
    note.textContent = err.message || String(err); note.dataset.kind = 'err';
    go.disabled = false; go.textContent = 'Create';
  }
}
form.addEventListener('submit', (e) => { e.preventDefault(); create(); });

/* ---------- Import from Notion (in the compose menu) ---------- */
initNotionImport(menu, {
  areas: () => areas,
  current,
  save: saveOutline,
  done: (data, opened, msg) => {
    areas = data.areas;
    opened.forEach(openFold);
    render(); renderRecents(); refreshUpload();
    toast(msg);
  },
});

/* ---------- drag to move: onto a folder puts it inside, between rows reorders ---------- */
// Mouse: press and move. Touch: hold for a moment, then drag (a quick swipe still scrolls).
type Where = 'before' | 'after' | 'into' | 'start';
let press: { x: number; y: number; at: string; label: HTMLElement; touch: boolean; timer?: number } | null = null;
let drag: { at: string; label: HTMLElement; ghost: HTMLElement; x: number; y: number; target: { at: string; where: Where } | null } | null = null;
let quietClick = 0;
const line = document.createElement('div'); line.className = 'drop-line'; line.hidden = true; document.body.append(line);

const labelOf = (t: EventTarget | null) => {
  const l = (t as HTMLElement | null)?.closest?.<HTMLElement>('.tree summary, .tree .pg');
  const row = l?.closest<HTMLElement>('[data-node]');
  return l && row && tree.contains(row) ? { label: l, at: row.dataset.node! } : null;
};
tree.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || (e.target as HTMLElement).closest('.fold-add')) return;
  const hit = labelOf(e.target); if (!hit) return;
  press = { x: e.clientX, y: e.clientY, ...hit, touch: e.pointerType !== 'mouse' };
  if (press.touch) press.timer = window.setTimeout(() => press && startDrag(press.x, press.y), 380);
});
tree.addEventListener('dragstart', (e) => e.preventDefault()); // links' own drag would cancel ours
tree.addEventListener('contextmenu', (e) => { if (press?.touch || drag) e.preventDefault(); });
window.addEventListener('pointermove', (e) => {
  if (drag) { moveDrag(e.clientX, e.clientY); return; }
  if (!press) return;
  const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8;
  if (!far) return;
  if (press.touch) { clearTimeout(press.timer); press = null; } // that's a scroll
  else startDrag(e.clientX, e.clientY);
});
const endPress = () => { if (press) clearTimeout(press.timer); press = null; };
window.addEventListener('pointerup', () => { endPress(); if (drag) dropDrag(); });
window.addEventListener('pointercancel', () => { endPress(); if (drag) cancelDrag(); });
document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
document.addEventListener('keydown', (e) => { if (drag && e.key === 'Escape') cancelDrag(); });
// The click that ends a drag doesn't open the page or fold the folder.
tree.addEventListener('click', (e) => { if (Date.now() - quietClick < 400) { e.preventDefault(); e.stopPropagation(); } }, true);

function startDrag(x: number, y: number) {
  if (!press) return;
  const { at, label } = press; press = null;
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = `${label.querySelector('.ico')?.outerHTML || ''}<span>${esc(label.querySelector('.pg-t, .fold-t')?.textContent || '')}</span>`;
  document.body.append(ghost);
  label.classList.add('dragging');
  document.documentElement.classList.add('tree-drag');
  getSelection()?.removeAllRanges();
  navigator.vibrate?.(8);
  drag = { at, label, ghost, x, y, target: null };
  moveDrag(x, y);
  requestAnimationFrame(autoScroll);
}
function moveDrag(x: number, y: number) {
  if (!drag) return;
  drag.x = x; drag.y = y;
  drag.ghost.style.transform = `translate(${x + 14}px, ${y - 18}px)`;
  tree.querySelector('.drop-into')?.classList.remove('drop-into');
  line.hidden = true; drag.target = null;
  const hit = labelOf(document.elementFromPoint(x, y));
  if (!hit) return;
  const from = drag.at, isF = hit.label.tagName === 'SUMMARY', fromFolder = isFolder(nodeAt(areas, from)!);
  if (hit.at === from || hit.at.startsWith(from + '.')) return; // not into itself
  const r = hit.label.getBoundingClientRect(), rel = (y - r.top) / r.height;
  let where: Where = isF ? (rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'into') : rel < 0.5 ? 'before' : 'after';
  const det = isF ? hit.label.parentElement as HTMLDetailsElement : null;
  if (where === 'after' && det?.open) where = 'start'; // below an open folder's name = its first item
  if (!fromFolder && !hit.at.includes('.') && (where === 'before' || where === 'after')) return; // pages go inside folders
  drag.target = { at: hit.at, where };
  if (where === 'into') { hit.label.classList.add('drop-into'); return; }
  const t = tree.getBoundingClientRect(), indent = where === 'start' ? 22 : 0;
  line.style.top = `${(where === 'before' ? r.top : r.bottom) - 1}px`;
  line.style.left = `${r.left + indent}px`; line.style.width = `${Math.min(r.width, t.right - r.left) - indent}px`;
  line.hidden = false;
}
function autoScroll() {
  if (!drag) return;
  const edge = 80, h = innerHeight - 70; // the bottom bar covers the last 70px
  const v = drag.y < edge ? -(edge - drag.y) / 4 : drag.y > h - edge ? (drag.y - (h - edge)) / 4 : 0;
  if (v) { scrollBy(0, v); moveDrag(drag.x, drag.y); }
  requestAnimationFrame(autoScroll);
}
function cancelDrag() {
  if (!drag) return;
  drag.ghost.remove(); drag.label.classList.remove('dragging');
  tree.querySelector('.drop-into')?.classList.remove('drop-into');
  line.hidden = true; document.documentElement.classList.remove('tree-drag');
  drag = null; quietClick = Date.now();
}
async function dropDrag() {
  const d = drag!; const t = d.target; cancelDrag();
  if (!t) return;
  try {
    const data = await current();
    const node = nodeAt(data.areas, d.at), from = listOf(data.areas, d.at), target = nodeAt(data.areas, t.at), dest0 = listOf(data.areas, t.at);
    if (!node || !from || !target || !dest0) throw new Error('The list changed. Try again.');
    from.splice(from.indexOf(node), 1);
    let dest: Node[], i: number;
    if (t.where === 'into' || t.where === 'start') {
      dest = (target as Folder).topics; i = t.where === 'start' ? 0 : dest.length;
      openFold(foldPath(data.areas, target as Folder));
    } else { dest = dest0; i = dest.indexOf(target) + (t.where === 'after' ? 1 : 0); }
    if (dest === data.areas && !isFolder(node)) throw new Error('Pages go inside a folder.');
    dest.splice(i, 0, node);
    await saveOutline(data, `Rearrange folders`);
    areas = data.areas;
    render(); refreshUpload();
    notice.hidden = true;
  } catch (err: any) { toast(err.message || 'Couldn’t move that.'); }
}
const foldPath = (all: Folder[], f: Folder) => {
  const hit = allFolders(all).find((x) => nodeAt(all, x.at) === f);
  return hit ? hit.path.join(' / ') : f.title;
};

/* ---------- Upload: send everything saved on this device to GitHub ---------- */
const upBtn = document.querySelector<HTMLButtonElement>('[data-upload]')!;
const upNote = document.querySelector<HTMLElement>('[data-upload-note]')!;
function refreshUpload() {
  const n = outboxIndex().files.length;
  upBtn.disabled = !n;
  upBtn.textContent = n ? `Upload ${n} change${n === 1 ? '' : 's'}` : 'Everything’s uploaded';
  upBtn.classList.toggle('has', !!n);
}
async function doUpload() {
  upBtn.disabled = true; upBtn.textContent = 'Uploading…'; upNote.textContent = ''; upNote.dataset.kind = '';
  try {
    // Pages that came from a Notion link: send their changes to Notion first (the map rides along in this upload).
    let notionNote = '';
    try { notionNote = await syncToNotion((t) => (upBtn.textContent = t)); } catch (e: any) { notionNote = `Notion: ${e?.message || e}`; }
    const sent = isStaged(OUTLINE) ? await current() : null;
    const done = await withKey(async () => upload(), doUpload);
    if (!done) { refreshUpload(); return; }
    if (sent) store.set('cfi.upOutline', { at: Date.now(), data: sent });
    store.set('cfi.notice', `Uploaded ${done.count} change${done.count === 1 ? '' : 's'}. The site shows them in about 2 minutes.${notionNote ? ' ' + notionNote : ''}`);
    location.reload();
  } catch (err: any) {
    upNote.textContent = err.message || 'Couldn’t upload. Your changes are still saved here.'; upNote.dataset.kind = 'err';
    refreshUpload();
  }
}
upBtn.addEventListener('click', doUpload);
window.addEventListener('cfi:outbox', refreshUpload);
refreshUpload();

/* ---------- start: the built list first, then this device's version ---------- */
render();
renderRecents();
(async () => {
  if (!isStaged(OUTLINE)) return;
  const t = await readLocal(OUTLINE);
  if (t) { areas = JSON.parse(t).areas; render(); renderRecents(); }
})();
