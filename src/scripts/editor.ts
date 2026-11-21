// In-page editor. Tap the pencil and every paragraph, heading, list and table in the lesson becomes
// editable in place. Save turns each changed block back into MDX and commits it to the binder's GitHub
// repo (GitHub Pages then rebuilds the site in about 2 minutes). Anything else (videos, figures,
// callout titles, frontmatter) can be changed in the full source editor.
const article = document.querySelector<HTMLElement>('[data-article]');
const bar = document.querySelector<HTMLElement>('.editbar');

if (article && bar) {
  const html = document.documentElement;
  const base = new URL(document.body.dataset.base || '/', document.baseURI).href;
  const repo = document.body.dataset.repo || 'Frenchbear1/CFI-Binder';
  const file = article.dataset.srcFile!;
  const slug = article.dataset.slug!;
  const status = bar.querySelector<HTMLElement>('[data-eb-status]')!;
  const saveBtn = bar.querySelector<HTMLButtonElement>('[data-cmd="save"]')!;
  const doneBtn = bar.querySelector<HTMLButtonElement>('[data-cmd="done"]')!;
  const pop = document.querySelector<HTMLFormElement>('[data-eb-pop]')!;
  const popInput = pop.querySelector<HTMLInputElement>('[data-eb-input]')!;
  const srcDlg = document.getElementById('sheet-source') as HTMLDialogElement;
  const tokDlg = document.getElementById('sheet-token') as HTMLDialogElement;
  const TOKEN = 'cfi.ghToken';
  const dirty = new Set<HTMLElement>();
  let on = false;
  let armedDiscard = false;
  let afterToken: (() => void) | null = null;

  // Text you can type into: tagged markdown blocks (not component wrappers), title/summary, and fields of new blocks.
  const blocks = () => [...article.querySelectorAll<HTMLElement>('[data-src]:not([data-comp]):not([data-kind]), [data-fm], [data-ed]')];
  const pending = () => dirty.size + article.querySelectorAll('[data-deleted]').length + article.querySelectorAll('[data-new]').length;
  const say = (t: string, kind = '') => { status.textContent = t; status.dataset.kind = kind; };
  const token = () => { try { return localStorage.getItem(TOKEN) || ''; } catch { return ''; } };
  const refresh = () => {
    const n = pending();
    saveBtn.disabled = !n;
    saveBtn.textContent = n ? `Save ${n}` : 'Save';
    armedDiscard = false; doneBtn.textContent = 'Done';
  };

  /* ---------- on / off ---------- */
  function setEditing(v: boolean) {
    on = v;
    html.classList.toggle('editing', on);
    bar.hidden = !on;
    for (const el of blocks()) {
      if (on) { el.contentEditable = 'true'; el.spellcheck = true; }
      else el.removeAttribute('contenteditable');
    }
    // References, figures and videos inside a block move as one piece.
    article.querySelectorAll<HTMLElement>('.r, .video, svg').forEach((x) => (on ? (x.contentEditable = 'false') : x.removeAttribute('contenteditable')));
    if (on) say(pending() ? '' : 'Tap any text to change it');
    else { pop.hidden = true; say(''); tools.hidden = true; }
  }
  document.querySelectorAll<HTMLElement>('[data-edit-toggle]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
    setEditing(!on);
  }));
  article.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    // Typing "/" into an empty text block opens the block menu, like Notion.
    const blk = t.closest<HTMLElement>('[data-new], [data-src]:not([data-comp])');
    if (blk && /^(P|DIV)$/.test(blk.tagName) && (blk.textContent || '').trim() === '/') { slashFrom = blk; openMenu(blk); }
    const el = t.closest<HTMLElement>('[data-new], [data-src], [data-fm]');
    if (!el || el.dataset.new !== undefined || el.dataset.comp) { refresh(); return; }
    dirty.add(el); refresh(); say('');
  });
  // Enter at a heading starts a new paragraph under it; the title and summary stay one line.
  article.addEventListener('keydown', (e) => {
    if (!on || e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-fm], summary, .callout-title, figcaption, [data-f="title"], [data-f="channel"]')) { e.preventDefault(); return; }
    const h = t.closest<HTMLElement>('h2, h3, h4');
    if (h && (h.dataset.src || h.dataset.new !== undefined)) { e.preventDefault(); insertAfter(h, 'p'); }
  });
  // Paste as plain text so formatting from other sites doesn't come along.
  article.addEventListener('paste', (e) => {
    if (!on) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
  });

  /* ---------- toolbar ---------- */
  let saved: Range | null = null;
  const keepSel = () => { const s = getSelection(); saved = s && s.rangeCount && article.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; };
  const restoreSel = () => { if (!saved) return false; const s = getSelection()!; s.removeAllRanges(); s.addRange(saved); return true; };
  bar.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('[data-cmd]')) e.preventDefault(); }); // keep the text selection
  let popMode: 'link' | 'ref' = 'link';
  function openPop(mode: 'link' | 'ref') {
    keepSel();
    if (!saved) { say('Tap into the text first'); return; }
    popMode = mode;
    pop.querySelector('[data-eb-label]')!.textContent = mode === 'link' ? 'Link to' : 'Reference';
    popInput.placeholder = mode === 'link' ? 'https://…' : 'PHAK 5-15; AIM 1-2-3; 14 CFR 91.3';
    const a = mode === 'link' ? (saved.startContainer.parentElement?.closest('a') as HTMLAnchorElement | null) : null;
    popInput.value = a ? a.getAttribute('href') || '' : '';
    pop.hidden = false;
    popInput.focus();
  }
  pop.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = popInput.value.trim();
    pop.hidden = true;
    if (!restoreSel()) return;
    const host = (saved!.startContainer.parentElement || article).closest<HTMLElement>('[data-src], [data-fm]');
    if (popMode === 'link') {
      if (!v) document.execCommand('unlink');
      else {
        const url = /^(https?:|mailto:|\/|#)/.test(v) ? v : `https://${v}`;
        if (saved!.collapsed) document.execCommand('insertHTML', false, `<a href="${attr(url)}">${esc(v)}</a>`);
        else document.execCommand('createLink', false, url);
      }
    } else if (v) {
      document.execCommand('insertHTML', false, ` <span class="r" data-r-to="${attr(v)}" contenteditable="false"><a href="#">${esc(v.replace(/;\s*/g, ' · '))}</a></span>`);
    }
    if (host) { dirty.add(host); refresh(); }
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pop.hidden = true; restoreSel(); } });

  bar.addEventListener('click', async (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]')?.dataset.cmd;
    if (!cmd) return;
    if (cmd === 'bold' || cmd === 'italic') {
      document.execCommand(cmd);
      const s = getSelection();
      const host = s?.anchorNode?.parentElement?.closest<HTMLElement>('[data-src], [data-fm]');
      if (host) { dirty.add(host); refresh(); }
    }
    if (cmd === 'link' || cmd === 'ref') openPop(cmd);
    if (cmd === 'source') openSource();
    if (cmd === 'add') { const at = current && article.contains(current) ? current : lastTop(); if (at) openMenu(at); }
    if (cmd === 'save') save();
    if (cmd === 'done') {
      if (pending() && !armedDiscard) { armedDiscard = true; doneBtn.textContent = 'Discard?'; say(`${pending()} unsaved`); return; }
      if (pending()) { dirty.clear(); article.querySelectorAll('[data-new], [data-deleted]').forEach((x) => x.remove()); location.reload(); return; }
      setEditing(false);
    }
  });

  /* ---------- turning the page back into MDX ---------- */
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const attr = (t: string) => esc(t).replace(/"/g, '&quot;');
  const mdText = (t: string) => t.replace(/ /g, ' ').replace(/\\/g, '\\\\').replace(/([*_`[\]{}<])/g, '\\$1');
  const wrap = (m: string, inner: string) => {
    const [, a, body, b] = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    return body ? `${a}${m}${body}${m}${b}` : inner;
  };
  function inline(node: Node, jsx = false): string {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) { out += mdText(n.textContent || ''); return; }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (el.classList.contains('r')) {
        const to = el.dataset.rTo || el.textContent || '', q = el.dataset.rQ;
        out += `<R to="${to.replace(/"/g, '&quot;')}"${q ? ` q="${q.replace(/"/g, '&quot;')}"` : ''} />`;
        return;
      }
      if (tag === 'br') { out += ' '; return; }
      const inner = inline(el, jsx);
      if (!inner.trim()) { out += inner; return; }
      if (tag === 'strong' || tag === 'b') out += jsx ? `<strong>${inner}</strong>` : wrap('**', inner);
      else if (tag === 'em' || tag === 'i') out += jsx ? `<em>${inner}</em>` : wrap('*', inner);
      else if (tag === 'code') out += '`' + (el.textContent || '') + '`';
      else if (tag === 'a') out += jsx ? `<a href="${attr(el.getAttribute('href') || '')}">${inner}</a>` : `[${inner}](${(el.getAttribute('href') || '').replace(/[()\s]/g, encodeURIComponent)})`;
      else if (tag === 'sub' || tag === 'sup') out += `<${tag}>${inner}</${tag}>`;
      else out += inner;
    });
    return out;
  }
  const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
  // A paragraph may have grown new paragraphs (Enter makes a <div> or <p> inside it).
  function paragraphs(el: HTMLElement): string {
    const parts: string[] = [];
    let cur = document.createElement('span');
    const push = () => { const t = oneLine(inline(cur)); if (t) parts.push(t); cur = document.createElement('span'); };
    [...el.childNodes].forEach((n) => {
      if (n.nodeType === 1 && /^(DIV|P)$/.test((n as HTMLElement).tagName)) { push(); cur.append(n.cloneNode(true)); push(); }
      else cur.append(n.cloneNode(true));
    });
    push();
    return parts.join('\n\n');
  }
  function list(el: HTMLElement, depth = 0): string {
    const ordered = el.tagName === 'OL';
    const pad = '   '.repeat(depth);
    return [...el.children].filter((li) => li.tagName === 'LI').map((li, i) => {
      const own = document.createElement('span');
      const subs: string[] = [];
      li.childNodes.forEach((n) => {
        if (n.nodeType === 1 && /^(UL|OL)$/.test((n as HTMLElement).tagName)) subs.push(list(n as HTMLElement, depth + 1));
        else own.append(n.cloneNode(true));
      });
      return `${pad}${ordered ? `${i + 1}.` : '-'} ${oneLine(inline(own))}${subs.length ? '\n' + subs.join('\n') : ''}`;
    }).join('\n');
  }
  function table(el: HTMLElement): string {
    const rows = [...el.querySelectorAll('tr')].map((tr) => `| ${[...tr.children].map((c) => oneLine(inline(c)).replace(/\|/g, '\\|')).join(' | ')} |`);
    if (rows.length) rows.splice(1, 0, `| ${[...el.querySelector('tr')!.children].map(() => '---').join(' | ')} |`);
    return rows.join('\n');
  }
  const field = (el: HTMLElement, f: string) => el.querySelector<HTMLElement>(`[data-f="${f}"]`)!;
  const plain = (el: HTMLElement | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const jsxAttr = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const body = (el: HTMLElement) => (el.tagName === 'UL' || el.tagName === 'OL' ? list(el) : paragraphs(el)) || '…';
  const LV: Record<string, string> = { pa: 'Private', ir: 'Instrument', ca: 'Commercial' };
  const BUILD: Record<string, (el: HTMLElement) => string> = {
    hr: () => '---',
    callout: (el) => `<Callout kind="${el.dataset.k}"${plain(field(el, 'title')) ? ` title="${jsxAttr(plain(field(el, 'title')))}"` : ''}>\n\n${body(field(el, 'body'))}\n\n</Callout>`,
    compare: (el) => `<Compare>\n  <Fragment slot="c172">\n\n${body(field(el, 'c172'))}\n\n  </Fragment>\n  <Fragment slot="pa28">\n\n${body(field(el, 'pa28'))}\n\n  </Fragment>\n</Compare>`,
    level: (el) => `<Level ${el.dataset.lv}>\n\n${body(field(el, 'body'))}\n\n</Level>`,
    toggle: (el) => `<Toggle title="${jsxAttr(plain(field(el, 'title')) || 'More')}">\n\n${body(field(el, 'body'))}\n\n</Toggle>`,
    video: (el) => `<Video youtube="${el.dataset.yt}" title="${jsxAttr(plain(field(el, 'title')) || 'Video')}"${plain(field(el, 'channel')) && plain(field(el, 'channel')) !== 'Channel' ? ` channel="${jsxAttr(plain(field(el, 'channel')))}"` : ''} />`,
    image: (el) => `<Figure caption="${jsxAttr(plain(field(el, 'caption')))}"${plain(field(el, 'credit')) ? ` credit="${jsxAttr(plain(field(el, 'credit')))}"` : ''}>\n  <img src="${jsxAttr(el.dataset.img || '')}" alt="${jsxAttr(plain(field(el, 'caption')))}" />\n</Figure>`,
  };
  function toMdx(el: HTMLElement): string {
    if (el.dataset.kind && BUILD[el.dataset.kind]) return BUILD[el.dataset.kind](el);
    const tag = el.tagName.toLowerCase();
    const jsxSrc = el.dataset.jsx; // a raw HTML element written in the .mdx (e.g. the key points list)
    if (jsxSrc !== undefined) return `<${tag}${jsxSrc}>${oneLine(inline(el, true))}</${tag}>`;
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${oneLine(inline(el))}`;
    if (tag === 'ul' || tag === 'ol') return list(el);
    if (tag === 'table') return table(el);
    if (tag === 'blockquote') return paragraphs(el).split('\n\n').map((p) => `> ${p}`).join('\n>\n');
    return paragraphs(el);
  }

  /* ---------- GitHub ---------- */
  const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token()}`, ...(init.headers || {}) },
  });
  const b64decode = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const b64encode = (t: string) => { let s = ''; new TextEncoder().encode(t).forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
  async function latest(): Promise<{ text: string; sha: string }> {
    const r = await gh(`contents/${file}?ref=main&t=${Date.now()}`);
    if (r.status === 401 || r.status === 403 || r.status === 404) throw Object.assign(new Error('key'), { key: true });
    if (!r.ok) throw new Error(`GitHub said ${r.status}`);
    const j = await r.json();
    return { text: b64decode(j.content), sha: j.sha };
  }
  async function commit(text: string, sha: string, message: string) {
    const r = await gh(`contents/${file}`, { method: 'PUT', body: JSON.stringify({ message, content: b64encode(text), sha, branch: 'main' }) });
    if (r.status === 409) throw new Error('The lesson changed on GitHub while you were editing. Reload and try again.');
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('key'), { key: true });
    if (!r.ok) throw new Error(`GitHub said ${r.status}`);
    return (await r.json()).content.sha as string;
  }
  function needKey(then: () => void) {
    afterToken = then;
    tokDlg.showModal();
    tokDlg.querySelector<HTMLInputElement>('[data-token-input]')!.focus();
  }
  tokDlg.querySelector('[data-token-form]')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = tokDlg.querySelector<HTMLInputElement>('[data-token-input]')!.value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN, v); } catch {}
    tokDlg.close();
    const f = afterToken; afterToken = null; f?.();
  });
  tokDlg.addEventListener('click', (e) => { if (e.target === tokDlg) tokDlg.close(); });

  let buildSrc: Promise<string> | null = null;
  const builtFrom = () => (buildSrc ??= fetch(new URL(`source/${slug}.txt`, base)).then((r) => r.text()));
  const yamlStr = (t: string) => JSON.stringify(t.replace(/\s+/g, ' ').trim());

  // Upload pictures added from the device into public/images/ first, so the lesson can point at them.
  async function uploadImages() {
    for (const el of article.querySelectorAll<HTMLElement>('[data-kind="image"][data-upload]')) {
      const data = el.dataset.upload!;
      const name = `images/${slug.replace(/\W+/g, '-')}-${Date.now().toString(36)}.jpg`;
      const r = await gh(`contents/public/${name}`, { method: 'PUT', body: JSON.stringify({ message: `Add picture for ${slug}`, content: data.split(',')[1], branch: 'main' }) });
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error('key'), { key: true });
      if (!r.ok) throw new Error(`Picture upload failed (${r.status})`);
      el.dataset.img = (document.body.dataset.base || '/') + name;
      delete el.dataset.upload;
    }
  }
  // The new blocks sitting right after an existing block, in order.
  const runAfter = (el: HTMLElement) => {
    const out: HTMLElement[] = [];
    for (let n = el.nextElementSibling as HTMLElement | null; n && n.dataset.new !== undefined; n = n.nextElementSibling as HTMLElement | null) out.push(n);
    return out;
  };

  async function save() {
    if (!pending()) return;
    if (!token()) return needKey(save);
    say('Saving…');
    saveBtn.disabled = true;
    try {
      const [built, cur] = await Promise.all([builtFrom(), latest()]);
      await uploadImages();
      let text = cur.text;
      const same = cur.text === built;
      type Op = { el: HTMLElement; key: number; s: number; e: number; orig: string; md: string; ins: boolean; run?: HTMLElement[] };
      const ops: Op[] = [];
      for (const el of article.querySelectorAll<HTMLElement>('[data-src]')) {
        if (el.parentElement?.closest('[data-deleted]')) continue; // inside something being deleted
        const [s, e] = el.dataset.src!.split('-').map(Number);
        const orig = el.dataset.mdNow ?? built.slice(s, e);
        const base = { el, s, e, orig };
        if (el.dataset.deleted !== undefined) ops.push({ ...base, key: s, md: '', ins: false });
        else if (dirty.has(el)) ops.push({ ...base, key: s, md: toMdx(el), ins: false });
        const run = runAfter(el);
        if (run.length) ops.push({ ...base, key: e + 0.5, md: run.map(toMdx).join('\n\n'), ins: true, run });
      }
      // Where each change lands in the file as it is on GitHub now (offsets only hold for an unchanged file).
      for (const op of ops) if (!(same && op.el.dataset.mdNow === undefined)) {
        const at = cur.text.indexOf(op.orig);
        op.key = at < 0 ? -1 : op.ins ? at + op.orig.length + 0.5 : at;
      }
      // Apply from the end of the file backwards so earlier offsets stay right.
      ops.sort((a, b) => b.key - a.key);
      const stale = 'The site is still updating from your last save. Try again in a minute, or use the source editor.';
      for (const op of ops) {
        let s0 = op.s, e0 = op.e;
        if (!(same && op.el.dataset.mdNow === undefined)) {
          const at = text.indexOf(op.orig);
          if (!op.orig || at < 0 || text.indexOf(op.orig, at + 1) >= 0) throw new Error(stale);
          s0 = at; e0 = at + op.orig.length;
        }
        if (op.ins) text = text.slice(0, e0) + '\n\n' + op.md + text.slice(e0);
        else text = text.slice(0, s0) + op.md + text.slice(e0);
      }
      for (const el of dirty) {
        if (!el.dataset.fm) continue;
        const key = el.dataset.fm;
        const re = new RegExp(`^${key}:.*$`, 'm');
        if (!re.test(text)) throw new Error(`Couldn’t find the ${key} line`);
        text = text.replace(re, `${key}: ${yamlStr(el.textContent || '')}`);
      }
      text = text.replace(/\n{3,}/g, '\n\n');
      if (text === cur.text) { dirty.clear(); refresh(); say('No changes'); return; }
      const title = document.querySelector('h1')?.textContent?.trim() || slug;
      await commit(text, cur.sha, `Edit “${title}” in the binder`);
      // The page now matches GitHub: remember each block's new text so later saves can find it.
      for (const op of ops) {
        if (op.ins) op.run!.forEach((n) => { n.dataset.mdNow = toMdx(n); n.dataset.src = 'x'; delete n.dataset.new; });
        else if (op.md) op.el.dataset.mdNow = op.md;
      }
      article.querySelectorAll('[data-deleted]').forEach((x) => x.remove());
      dirty.clear(); refresh();
      say('Saved. Live in about 2 min', 'ok');
    } catch (err: any) {
      if (err.key) { try { localStorage.removeItem(TOKEN); } catch {} say(''); refresh(); return needKey(save); }
      say(err.message || 'Couldn’t save', 'err');
      refresh();
    }
  }

  /* ---------- adding, deleting and moving blocks ---------- */
  const tools = document.querySelector<HTMLElement>('[data-blk-tools]')!;
  const menu = document.getElementById('sheet-insert') as HTMLDialogElement;
  let current: HTMLElement | null = null;
  let menuAt: HTMLElement | null = null;
  let slashFrom: HTMLElement | null = null;
  const target = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>('[data-new], [data-src]') : null);
  const lastTop = () => [...article.querySelectorAll<HTMLElement>(':scope > [data-src], :scope > [data-new]')].pop() || null;
  function place(el: HTMLElement | null) {
    current = el;
    if (!on || !el || el.dataset.deleted !== undefined) { tools.hidden = true; return; }
    const r = el.getBoundingClientRect(), a = article.getBoundingClientRect();
    tools.hidden = false;
    const wide = a.left > 70;
    tools.classList.toggle('inside', !wide);
    tools.style.top = `${r.top + scrollY + (wide ? 2 : -34)}px`;
    tools.style.left = wide ? `${a.left - 64}px` : `${Math.min(r.right, a.right) - tools.offsetWidth + scrollX}px`;
  }
  article.addEventListener('pointerover', (e) => { if (on && matchMedia('(hover: hover)').matches) { const t = target(e.target); if (t && t !== current) place(t); } });
  article.addEventListener('focusin', (e) => { if (on) place(target(e.target)); });
  article.addEventListener('click', (e) => { if (on) { const t = target(e.target); if (t) place(t); } });
  window.addEventListener('scroll', () => { if (on && current) place(current); }, { passive: true });
  tools.addEventListener('pointerdown', (e) => e.preventDefault());
  tools.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act || !current) return;
    if (act === 'add') openMenu(current);
    if (act === 'del') remove(current);
    if (act === 'up' || act === 'down') move(current, act === 'up' ? -1 : 1);
  });
  let lastDeleted: HTMLElement | null = null;
  function remove(el: HTMLElement) {
    if (el.dataset.new !== undefined) el.remove();
    else { el.dataset.deleted = ''; lastDeleted = el; dirty.delete(el); }
    tools.hidden = true; current = null;
    refresh();
    if (lastDeleted === el) { say(''); status.innerHTML = 'Deleted. <button type="button" class="link-btn" data-undo>Undo</button>'; }
  }
  status.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-undo]') || !lastDeleted) return;
    delete lastDeleted.dataset.deleted; lastDeleted = null; say(''); refresh();
  });
  // Moving = delete here, add a copy there (text blocks stay editable; components move as they are).
  async function move(el: HTMLElement, dir: number) {
    const sib = (dir < 0 ? el.previousElementSibling : el.nextElementSibling) as HTMLElement | null;
    if (!sib || !(sib.dataset.src || sib.dataset.new !== undefined)) { say('Can’t move further'); return; }
    let piece = el;
    if (el.dataset.new === undefined) {
      const [s, e] = el.dataset.src!.split('-').map(Number);
      const md = dirty.has(el) ? toMdx(el) : el.dataset.mdNow ?? (await builtFrom()).slice(s, e);
      piece = el.cloneNode(true) as HTMLElement;
      piece.removeAttribute('data-src'); piece.removeAttribute('data-md-now');
      piece.dataset.new = '';
      if (el.dataset.comp || el.dataset.kind || el.dataset.jsx !== undefined) { piece.dataset.kind = 'raw'; piece.dataset.raw = md; piece.querySelectorAll('[contenteditable]').forEach((x) => x.setAttribute('contenteditable', 'false')); piece.contentEditable = 'false'; }
      el.dataset.deleted = ''; dirty.delete(el);
      el.after(piece);
    }
    // Skip over deleted (hidden) blocks.
    let to: HTMLElement | null = sib;
    while (to && to.dataset.deleted !== undefined) to = (dir < 0 ? to.previousElementSibling : to.nextElementSibling) as HTMLElement | null;
    if (!to) return;
    if (dir < 0) {
      // New blocks can only follow an existing block, so moving above one means sitting after the block before it.
      to.before(piece);
      if (!(piece.previousElementSibling as HTMLElement | null)?.matches('[data-src], [data-new]')) { to.after(piece); say('That’s the top of this section'); }
    } else to.after(piece);
    refresh(); place(piece);
    piece.scrollIntoView({ block: 'nearest' });
  }
  BUILD.raw = (el) => el.dataset.raw || '';

  function openMenu(at: HTMLElement) {
    menuAt = at;
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
    menu.showModal();
  }
  menu.addEventListener('click', (e) => {
    if (e.target === menu) { menu.close(); return; }
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
    if (!b || !menuAt) return;
    menu.close();
    const at = menuAt;
    if (slashFrom && slashFrom === at) {
      if (slashFrom.dataset.new !== undefined) { const prev = slashFrom.previousElementSibling as HTMLElement; slashFrom.remove(); insertAfter(prev, b.dataset.kind!, b.dataset); }
      else { slashFrom.textContent = ''; remove(slashFrom); insertAfter(slashFrom, b.dataset.kind!, b.dataset); }
      slashFrom = null; return;
    }
    insertAfter(at, b.dataset.kind!, b.dataset);
  });
  menu.addEventListener('close', () => { slashFrom = null; });

  const ED = 'contenteditable="true" data-ed';
  const TEMPLATES: Record<string, (o: DOMStringMap) => string> = {
    p: () => `<p ${ED} data-ph="Type, or / for blocks"></p>`,
    h2: () => `<h2 ${ED} data-ph="Section heading"></h2>`,
    h3: () => `<h3 ${ED} data-ph="Sub-heading"></h3>`,
    ul: () => `<ul ${ED}><li></li></ul>`,
    ol: () => `<ol ${ED}><li></li></ol>`,
    table: () => `<table ${ED}><thead><tr><th>Item</th><th>C172</th><th>PA-28-181</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr></tbody></table>`,
    hr: () => `<hr>`,
    callout: (o) => `<aside class="callout ${o.k}"><span class="callout-icon" aria-hidden="true">${({ teach: '🎓', fleet: '✈️', warn: '⚠️', acs: '✅', note: '💡' } as any)[o.k!]}</span><div class="callout-body"><p class="callout-title" ${ED} data-f="title" data-ph="Title"></p><p ${ED} data-f="body" data-ph="What to say"></p></div></aside>`,
    compare: () => `<div class="compare"><div class="ac-card" data-only="c172"><p class="ac-name">Cessna 172</p><ul ${ED} data-f="c172"><li></li></ul></div><div class="ac-card" data-only="pa28"><p class="ac-name">Piper PA-28-181</p><ul ${ED} data-f="pa28"><li></li></ul></div></div>`,
    level: (o) => `<div class="lvl-preview"><p class="lvl-tag">${o.lv!.split(' ').map((k) => LV[k]).join(' · ')} only</p><p ${ED} data-f="body" data-ph="Shows only at this level"></p></div>`,
    toggle: () => `<details class="toggle" open><summary ${ED} data-f="title" data-ph="Toggle title"></summary><div class="toggle-body"><p ${ED} data-f="body" data-ph="Hidden until tapped"></p></div></details>`,
    video: (o) => `<div class="video-frame" style="background:#000 url(https://i.ytimg.com/vi/${o.yt}/hqdefault.jpg) center/cover"></div><figcaption><strong ${ED} data-f="title" data-ph="Video title"></strong> · <span ${ED} data-f="channel" data-ph="Channel"></span></figcaption>`,
    image: (o) => `<div class="figure-art"><img src="${attr(o.src!)}" alt=""></div><figcaption><span ${ED} data-f="caption" data-ph="Caption"></span> <span class="credit" ${ED} data-f="credit" data-ph="Source"></span></figcaption>`,
  };
  const WRAP: Record<string, string> = { callout: 'div', compare: 'div', level: 'div', toggle: 'div', video: 'figure', image: 'figure' };
  const askFor = (label: string, ph: string) => new Promise<string | null>((ok) => {
    pop.querySelector('[data-eb-label]')!.textContent = label;
    popInput.placeholder = ph; popInput.value = ''; pop.hidden = false; popInput.focus();
    const done = (v: string | null) => { pop.hidden = true; pop.removeEventListener('submit', sub, true); ok(v); };
    const sub = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); done(popInput.value.trim() || null); };
    pop.addEventListener('submit', sub, true);
    popInput.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { popInput.removeEventListener('keydown', esc); done(null); } });
  });
  const pickFile = () => new Promise<File | null>((ok) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => ok(inp.files?.[0] || null); inp.click();
  });
  async function shrink(f: File) {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }
  async function insertAfter(at: HTMLElement, kind: string, opts: DOMStringMap = {}) {
    const o: DOMStringMap = { ...opts };
    if (kind === 'video') {
      const v = await askFor('YouTube link', 'https://youtu.be/…');
      const id = v?.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/)?.[1] || (v && /^[\w-]{11}$/.test(v) ? v : null);
      if (!id) { if (v) say('That isn’t a YouTube link', 'err'); return; }
      o.yt = id;
    }
    let upload = '';
    if (kind === 'image') {
      const v = await askFor('Picture link, or leave empty to pick a photo', 'https://… (empty = choose a file)');
      if (v) o.src = v;
      else {
        const f = await pickFile(); if (!f) return;
        upload = await shrink(f); o.src = upload;
      }
    }
    const tag = WRAP[kind] || (TEMPLATES[kind] ? TEMPLATES[kind](o).match(/^<(\w+)/)![1] : 'p');
    const holder = document.createElement('div');
    holder.innerHTML = WRAP[kind] ? `<${tag}>${TEMPLATES[kind](o)}</${tag}>` : TEMPLATES[kind](o);
    const el = holder.firstElementChild as HTMLElement;
    el.dataset.new = '';
    el.classList.add('blk-new');
    if (WRAP[kind] || kind === 'hr') { el.dataset.kind = kind; el.contentEditable = 'false'; }
    if (kind === 'callout') el.dataset.k = o.k;
    if (kind === 'level') el.dataset.lv = o.lv;
    if (kind === 'video') { el.dataset.yt = o.yt; el.classList.add('video'); }
    if (kind === 'image') { el.classList.add('figure'); el.dataset.img = o.src!.startsWith('data:') ? '' : o.src; if (upload) el.dataset.upload = upload; }
    el.querySelectorAll('summary').forEach((x) => x.addEventListener('click', (e) => { if (on) e.preventDefault(); }));
    // Blocks inside a callout / card / level box go next to that box's own paragraphs; others after the block.
    (at.dataset.deleted !== undefined ? at : at).after(el);
    refresh(); say('');
    const first = el.matches('[data-ed]') ? el : el.querySelector<HTMLElement>('[data-ed]');
    if (first) {
      const li = first.querySelector('li') || first.querySelector('td');
      const r = document.createRange(); r.selectNodeContents(li || first); r.collapse(true);
      first.focus(); getSelection()!.removeAllRanges(); getSelection()!.addRange(r);
    }
    place(el);
    el.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- full source editor ---------- */
  const srcText = srcDlg.querySelector<HTMLTextAreaElement>('[data-src-text]')!;
  const srcNote = srcDlg.querySelector<HTMLElement>('[data-src-note]')!;
  let srcSha = '';
  async function openSource() {
    // Open at the block you were in.
    const sel = getSelection();
    const at = sel?.anchorNode && article.contains(sel.anchorNode) ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode as HTMLElement : sel.anchorNode.parentElement)?.closest<HTMLElement>('[data-src]') : null;
    const want = at ? (at.dataset.mdNow ?? (await builtFrom()).slice(...(at.dataset.src!.split('-').map(Number) as [number, number]))) : '';
    srcDlg.showModal();
    srcNote.textContent = 'Loading…';
    try {
      if (token()) { const cur = await latest(); srcText.value = cur.text; srcSha = cur.sha; srcNote.textContent = 'Latest version on GitHub'; }
      else { srcText.value = await builtFrom(); srcSha = ''; srcNote.textContent = 'Version this page was built from'; }
    } catch (err: any) {
      srcText.value = await builtFrom(); srcSha = '';
      srcNote.textContent = err.key ? 'Your GitHub key needs replacing' : 'Version this page was built from';
    }
    const i = want ? srcText.value.indexOf(want) : -1;
    if (i >= 0) {
      srcText.focus(); srcText.setSelectionRange(i, i);
      const lh = parseFloat(getComputedStyle(srcText).lineHeight) || 20;
      // Rough scroll: count wrapped lines up to the block.
      const cols = Math.max(20, Math.floor(srcText.clientWidth / 7.8));
      const lines = srcText.value.slice(0, i).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cols)), 0);
      srcText.scrollTop = Math.max(0, (lines - 3) * lh);
    }
  }
  srcDlg.querySelector('[data-src-save]')!.addEventListener('click', async () => {
    const go = async () => {
      srcNote.textContent = 'Saving…';
      try {
        if (!srcSha) srcSha = (await latest()).sha;
        srcSha = await commit(srcText.value, srcSha, `Edit “${document.querySelector('h1')?.textContent?.trim() || slug}” source in the binder`);
        srcNote.textContent = 'Saved. Live in about 2 min';
      } catch (err: any) {
        if (err.key) { try { localStorage.removeItem(TOKEN); } catch {} srcDlg.close(); return needKey(() => { srcDlg.showModal(); go(); }); }
        srcNote.textContent = err.message;
      }
    };
    if (!token()) { srcDlg.close(); return needKey(() => { srcDlg.showModal(); go(); }); }
    go();
  });
  srcDlg.querySelector('[data-close]')!.addEventListener('click', () => srcDlg.close());

  // Keep the toolbar above the on-screen keyboard.
  const vv = window.visualViewport;
  if (vv) {
    const place = () => { const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop); bar.style.setProperty('--kb', `${gap}px`); pop.style.setProperty('--kb', `${gap}px`); };
    vv.addEventListener('resize', place); vv.addEventListener('scroll', place);
  }
  window.addEventListener('beforeunload', (e) => { if (dirty.size) e.preventDefault(); });
}
