// "Import from Notion" on Home: bring a Notion page (with everything nested under it) into the binder as
// ordinary binder pages. One way only: nothing goes back to Notion, and later Notion edits don't come over.
// Two ways in: paste a Notion link (read on the server with the NOTION_TOKEN set on Vercel), or pick the
// .zip Notion makes from ••• → Export (read right here, no setup).
// A Notion page that has sub-pages becomes a folder: its own text goes first, as a page of the same name,
// then its sub-pages. Everything is saved on this device like any other change; Upload sends it to GitHub.
import { kebab } from '../gh';
import { savePage, type LocalPage } from '../outbox';
import { cloudOn } from '../cloud';
import { allFolders, nodeAt, isFolder, pagesIn, type Folder, type Node } from '../../data/tree';
import { toBlocks } from './mdx';
import type { ImportPage, Progress } from './types';
import { loadMap, mapFile, splitBlocks } from './sync';
import './notion.css';

type Outline = { _about?: string; areas: Folder[] };
type Ctx = {
  areas: () => Folder[];
  current: () => Promise<Outline>;
  save: (data: Outline, note: string, files: { path: string; content: string | { base64: string } }[], extra: { news?: LocalPage[]; folders?: string[] }) => Promise<void>;
  done: (data: Outline, opened: string[], msg: string) => void;
};

const base = document.body.dataset.base || '/';
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const yaml = (t: string) => JSON.stringify(t);
const MAX_IMG = 15 * 1024 * 1024; // GitHub won't take much bigger in one go
const NOTION = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5 15.5 3.7c1.3-.1 1.6 0 2.4.6l3.3 2.3c.5.4.7.5.7 1v12.6c0 .8-.3 1.3-1.3 1.3L8.4 22.3c-.8 0-1.1-.1-1.5-.6L4 18c-.4-.6-.6-1-.6-1.6V6c0-.8.3-1.4 1.6-1.5z"/><path d="M9 8.5v10M9 8.5l7 10V8"/></svg>';

const lessonFile = (o: { title: string; area: string; levels: string[] }) => `---
title: ${yaml(o.title)}
summary: ""
area: ${yaml(o.area)}
levels: [${o.levels.join(', ')}]
order: 0
updated: ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
---
`;
const hasBody = (html: string) => /<(img|table|figure|aside|details|pre|hr|div)\b/i.test(html) || html.replace(/<[^>]+>/g, '').trim().length > 0;
const count = (p: ImportPage): number => 1 + p.children.reduce((n, c) => n + count(c), 0);
const blobB64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

export function initNotionImport(menu: HTMLElement, ctx: Ctx) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.dataset.notionImport = '';
  btn.innerHTML = `<span class="ico">${NOTION}</span>Import from Notion`;
  menu.append(btn);

  const dlg = document.createElement('dialog');
  dlg.className = 'sheet new-sheet notion-sheet'; dlg.setAttribute('aria-label', 'Import from Notion');
  dlg.innerHTML = `<div class="grab" aria-hidden="true"></div>
  <form data-ni-form>
    <div class="new-top"><button type="button" class="link-btn" data-close>Cancel</button><p class="sheet-h">Import from Notion</p><button type="submit" class="eb-save" data-ni-go>Import</button></div>
    <div class="seg seg-full new-kind" role="radiogroup" aria-label="Import from">
      <button type="button" role="radio" data-ni-kind="link" aria-checked="true">Notion link</button>
      <button type="button" role="radio" data-ni-kind="zip" aria-checked="false">Export file (.zip)</button>
    </div>
    <div data-ni-link>
      <input class="ni-in" name="url" type="url" inputmode="url" placeholder="Paste a Notion page link" autocomplete="off" data-ni-url />
      <p class="muted small">Sub-pages and database rows come too. The page has to be shared with your binder connection in Notion (••• → Connections).</p>
    </div>
    <div data-ni-zip hidden>
      <label class="ni-file"><input type="file" accept=".zip,application/zip" data-ni-file /><span data-ni-file-t>Choose the .zip from Notion</span></label>
      <p class="muted small">In Notion: ••• → Export → Markdown &amp; CSV (or HTML), with “Include subpages” and “Create folders for subpages” on. No setup needed.</p>
    </div>
    <label class="new-row"><span>Into</span><select data-ni-where></select></label>
    <p class="new-row-l">Shows for</p>
    <div class="new-levels">${[['pa', 'Private'], ['ir', 'Instrument'], ['ca', 'Commercial']].map(([k, v]) => `<label><input type="checkbox" name="lv" value="${k}" checked /> ${v}</label>`).join('')}</div>
    <p class="muted small ni-note" data-ni-note></p>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector<HTMLFormElement>('[data-ni-form]')!;
  const urlIn = form.querySelector<HTMLInputElement>('[data-ni-url]')!;
  const fileIn = form.querySelector<HTMLInputElement>('[data-ni-file]')!;
  const whereSel = form.querySelector<HTMLSelectElement>('[data-ni-where]')!;
  const note = form.querySelector<HTMLElement>('[data-ni-note]')!;
  const go = form.querySelector<HTMLButtonElement>('[data-ni-go]')!;
  let kind: 'link' | 'zip' = 'link';
  let busy = false;
  const say: Progress = (m) => { note.textContent = m; note.dataset.kind = 'busy'; };
  const setKind = (k: 'link' | 'zip') => {
    kind = k;
    form.querySelectorAll<HTMLElement>('[data-ni-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.niKind === k)));
    form.querySelector<HTMLElement>('[data-ni-link]')!.hidden = k !== 'link';
    form.querySelector<HTMLElement>('[data-ni-zip]')!.hidden = k !== 'zip';
  };
  form.querySelectorAll<HTMLElement>('[data-ni-kind]').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.niKind as 'link' | 'zip')));
  fileIn.addEventListener('change', () => { form.querySelector('[data-ni-file-t]')!.textContent = fileIn.files?.[0]?.name || 'Choose the .zip from Notion'; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && !busy) dlg.close(); });
  dlg.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });
  dlg.querySelector('[data-close]')!.addEventListener('click', () => { if (!busy) dlg.close(); });

  btn.addEventListener('click', () => {
    menu.hidden = true;
    whereSel.innerHTML = '<option value="">Top level (its own folder)</option>' + allFolders(ctx.areas()).map((f) => `<option value="${f.at}">${' '.repeat(f.depth)}${esc(f.title)}</option>`).join('');
    note.textContent = 'Saved on this device. Tap Upload on the home page to put it on the site.'; note.dataset.kind = '';
    go.disabled = false; go.textContent = 'Import';
    dlg.showModal();
    setTimeout(() => (kind === 'link' ? urlIn : fileIn).focus(), 50);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const levels = [...form.querySelectorAll<HTMLInputElement>('input[name="lv"]:checked')].map((c) => c.value);
    if (!levels.length) { note.textContent = 'Pick at least one level.'; note.dataset.kind = 'err'; return; }
    const url = urlIn.value.trim(), file = fileIn.files?.[0];
    if (kind === 'link' && !/[0-9a-f]{32}/i.test(url.replace(/-/g, ''))) { note.textContent = 'Paste the link to a Notion page (Share → Copy link).'; note.dataset.kind = 'err'; urlIn.focus(); return; }
    if (kind === 'zip' && !file) { note.textContent = 'Choose the .zip file Notion exported.'; note.dataset.kind = 'err'; return; }
    busy = true; go.disabled = true; go.textContent = 'Importing…';
    try {
      const roots = kind === 'link'
        ? [await (await import('./from-api')).readNotionLink(url, say)]
        : await (await import('./from-zip')).readNotionZip(file!, say);
      if (!roots.length) throw new Error('There were no pages in that export.');
      const r = await place(roots, whereSel.value, levels, ctx, say, kind === 'link');
      busy = false;
      dlg.close();
      ctx.done(r.data, r.opened, r.msg);
    } catch (err: any) {
      busy = false;
      note.textContent = err?.message || String(err); note.dataset.kind = 'err';
      go.disabled = false; go.textContent = 'Import';
    }
  });
}

/** Put the imported pages into the folder list and save every file on this device. */
async function place(roots: ImportPage[], at: string, levels: string[], ctx: Ctx, say: Progress, linked: boolean) {
  const sync = linked ? await loadMap() : null;
  const data = await ctx.current();
  const parent = at ? nodeAt(data.areas, at) : null;
  if (at && (!parent || !isFolder(parent))) throw new Error('That folder has moved. Pick it again.');
  const path = parent ? allFolders(data.areas).find((f) => f.at === at)!.path : [];
  const total = roots.reduce((n, p) => n + count(p), 0);

  // 1. Work out where every page goes and its slug, so links between imported pages can point at each other.
  const taken = new Set(pagesIn(data.areas).map((t) => t.slug).filter(Boolean) as string[]);
  const slugOf = new Map<string, string>();   // Notion id → binder slug
  type Job = { page: ImportPage; slug: string; area: string };
  const jobs: Job[] = [];
  const folders: string[] = [];
  const opened: string[] = [];
  const uniq = (dir: string, title: string) => { let s = `${dir}/${kebab(title)}`; for (let n = 2; taken.has(s); n++) s = `${dir}/${kebab(title)}-${n}`; taken.add(s); return s; };
  const folderName = (list: Node[], title: string) => {
    let t = title || 'Untitled', n = 2;
    while (list.some((x) => isFolder(x) && x.title.toLowerCase() === t.toLowerCase()) || (list === data.areas && t === 'Interactives')) t = `${title} (${n++})`;
    return t;
  };
  // Pages live in their top folder's directory on GitHub (same rule as New page).
  const dirFor = (top: Folder) => pagesIn(top.topics).find((t) => t.slug)?.slug!.split('/')[0] || kebab(top.title);

  const add = (p: ImportPage, list: Node[], where: string[], dir: string) => {
    const title = p.title.replace(/\s+/g, ' ').trim() || 'Untitled';
    if (p.children.length) {
      const name = folderName(list, title);
      const f: Folder = { title: name, topics: [] };
      list.push(f);
      const fp = [...where, name];
      folders.push(fp.join(' / '));
      opened.push(fp.join(' / '));
      if (hasBody(p.html)) { const slug = uniq(dir, title); slugOf.set(p.id, slug); f.topics.push({ title, slug, levels }); jobs.push({ page: p, slug, area: fp.join(' / ') }); }
      for (const c of p.children) add(c, f.topics, fp, dir);
      return;
    }
    const slug = uniq(dir, title);
    slugOf.set(p.id, slug);
    list.push({ title, slug, levels });
    jobs.push({ page: p, slug, area: where.join(' / ') });
  };
  for (const root of roots) {
    if (parent) {
      const top = data.areas[Number(at.split('.')[0])];
      add(root, (parent as Folder).topics, path, dirFor(top));
      path.forEach((_, i) => opened.push(path.slice(0, i + 1).join(' / ')));
    } else {
      // The top level holds only folders: a single page gets a folder of its own.
      const name = folderName(data.areas, root.title.trim() || 'Notion import');
      const f: Folder = { title: name, topics: [] };
      data.areas.push(f);
      folders.push(name); opened.push(name);
      if (root.children.length) {
        if (hasBody(root.html)) { const slug = uniq(kebab(name), root.title); slugOf.set(root.id, slug); f.topics.push({ title: root.title.trim() || name, slug, levels }); jobs.push({ page: root, slug, area: name }); }
        for (const c of root.children) add(c, f.topics, [name], kebab(name));
      } else add(root, f.topics, [name], kebab(name));
    }
  }
  if (!jobs.length) throw new Error('Those Notion pages are empty, so there was nothing to bring in.');

  // 2. Each page: fetch its pictures, write its MDX, and a copy of how it looks (shown until the site rebuilds).
  const files: { path: string; content: string | { base64: string } }[] = [];
  const news: LocalPage[] = [];
  const skipped: string[] = [];
  let i = 0;
  for (const j of jobs) {
    say(`Saving page ${++i} of ${jobs.length}${total > jobs.length ? ` (${total} in Notion)` : ''}: ${j.page.title}`);
    const site = new Map<string, string>(), shown = new Map<string, string>();
    let n = 0;
    for (const im of j.page.images) {
      try {
        const blob = await im.load();
        if (blob.size > MAX_IMG) { skipped.push(`${j.page.title}: a ${Math.round(blob.size / 1e6)} MB file`); continue; }
        const dataUrl = await blobB64(blob);
        const ext = (im.ext || 'bin').toLowerCase().replace(/^jpeg$/, 'jpg').replace(/[^a-z0-9]/g, '') || 'bin';
        const name = `uploads/notion-${kebab(j.slug.split('/').pop()!)}-${++n}.${ext}`;
        files.push({ path: `public/${name}`, content: { base64: dataUrl.split(',')[1] } });
        site.set(im.ref, base + name); shown.set(im.ref, dataUrl);
      } catch { skipped.push(`${j.page.title}: a picture that wouldn’t download`); }
    }
    const blocks = toBlocks(j.page.html, {
      image: (ref) => site.get(ref) || '', preview: (ref) => shown.get(ref) || '',
      page: (id) => slugOf.get(id.replace(/-/g, '')) || null, base,
    }).filter((b) => b.md.trim());
    // The file, and where each block sits in it (the page editor finds blocks by these offsets).
    let text = lessonFile({ title: j.page.title.trim() || 'Untitled', area: j.area, levels });
    let look = '';
    for (const b of blocks) {
      text += '\n';
      const s = text.length; text += b.md; const e = text.length;
      text += '\n';
      look += b.comp ? `<div data-src="${s}-${e}" data-comp="${b.comp}">${b.html}</div>` : tag(b.html, `${s}-${e}`, b.md);
    }
    files.push({ path: `src/content/lessons/${j.slug}.mdx`, content: text });
    // Linked pages remember which Notion blocks each block came from, so edits can go back on Upload.
    if (sync) {
      const parts = splitBlocks(text);
      const same = parts.length === blocks.length && parts.every((m, k) => m === blocks[k].md.trim());
      sync.pages[j.slug] = { page: j.page.id.replace(/-/g, ''), blocks: parts.map((md, k) => ({ md, ids: same ? blocks[k].ids || [] : blocks.find((b) => b.md.trim() === md)?.ids || [] })) };
    }
    const title = j.page.title.trim() || 'Untitled';
    news.push({ slug: j.slug, title, area: j.area, levels, at: Date.now() });
    await savePage(j.slug, article(title, j.area, look));
  }

  const what = roots.length === 1 ? `“${roots[0].title.trim() || 'Untitled'}”` : `${roots.length} Notion pages`;
  if (sync) files.push(mapFile(sync));
  await ctx.save(data, `Import ${what} from Notion${path.length ? ` into ${path.join(' / ')}` : ''}`, files, { news, folders });
  const msg = `Imported ${jobs.length} page${jobs.length === 1 ? '' : 's'} from Notion on this device. Tap Upload to put ${jobs.length === 1 ? 'it' : 'them'} on the site.`
    + (skipped.length ? ` Left out: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''}.` : '');
  return { data, opened: [...new Set(opened)], msg };
}

// Text blocks are tagged with where they sit in the file, like the site's own pages, so they can be edited
// before Upload. Code and dividers aren't, just as on built pages.
function tag(html: string, src: string, md: string) {
  if (/^(```|~~~|---$)/.test(md)) return html;
  return html.replace(/^<(\w+)/, `<$1 data-src="${src}"`);
}
const article = (title: string, area: string, body: string) =>
  `<p class="crumbs" data-pagefind-ignore><a href="${base}">Binder</a> / ${esc(area)}</p><h1 data-pagefind-meta="title" data-fm="title">${esc(title)}</h1><p class="lede" data-fm="summary" data-ph="Add a one-line summary"></p><p class="meta-line" data-pagefind-ignore>${cloudOn ? '' : 'Not uploaded yet · '}Imported from Notion</p>${body}`;
