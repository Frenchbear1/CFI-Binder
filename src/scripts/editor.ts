// In-page editor, laid out like Notion's phone app.
// Tap the pencil: every block becomes editable. The bar on the keyboard has search-this-page, + (add a
// block), Aa (bold / italic / underline / strike / link / code / reference), picture, turn into, undo and
// redo. + and Turn into open a scrolling sheet of blocks; typing "/" filters the same list in place.
// Save turns each changed block back into MDX at its exact spot in the lesson file and keeps it on this
// device (with a copy of the page as you see it); Upload on the home page sends everything to GitHub.
import { pagesIn, isFolder, type Folder } from '../data/tree';
import { kebab } from './gh';
import { stage, readLocal, savePage, loadPage, hasPage, expire, dropPage, index as outboxIndex } from './outbox';

const article = document.querySelector<HTMLElement>('[data-article]')!; // may be null off lesson pages; checked below
const bar = document.querySelector<HTMLElement>('.editbar')!;

if (article && bar) {
  const html = document.documentElement;
  const base = new URL(document.body.dataset.base || '/', document.baseURI).href;
  const basePath = document.body.dataset.base || '/';
  const file = article.dataset.srcFile!;
  const slug = article.dataset.slug!;
  const head = document.querySelector<HTMLElement>('.edit-head')!;
  const status = head.querySelector<HTMLElement>('[data-eb-status]')!;
  const saveBtn = head.querySelector<HTMLButtonElement>('[data-cmd="save"]')!;
  const doneBtn = head.querySelector<HTMLButtonElement>('[data-cmd="done"]')!;
  saveBtn.hidden = true; // saving is automatic now
  const moreMenu = head.querySelector<HTMLElement>('[data-more-menu]')!;
  const panel = document.querySelector<HTMLElement>('.blk-panel')!;
  const pop = document.querySelector<HTMLFormElement>('[data-eb-pop]')!;
  const popInput = pop.querySelector<HTMLInputElement>('[data-eb-input]')!;
  const srcDlg = document.getElementById('sheet-source') as HTMLDialogElement;
  const tools = document.querySelector<HTMLElement>('[data-blk-tools]')!;
  const outline: Folder[] = JSON.parse(document.getElementById('outline-data')?.textContent || '[]');
  const dirty = new Set<HTMLElement>();
  let on = false;
  let armedDiscard = false;
  let current: HTMLElement | null = null; // block the tools / + / turn-into act on

  // Text you can type into: tagged markdown blocks (not component wrappers), title/summary, and fields of new blocks.
  const blocks = () => [...article.querySelectorAll<HTMLElement>('[data-src]:not([data-comp]):not([data-kind]), [data-fm], [data-ed]')];
  const pending = () => dirty.size + article.querySelectorAll('[data-deleted]').length + [...article.querySelectorAll<HTMLElement>('[data-new]')].filter((x) => !(x.tagName === 'P' && !(x.textContent || '').trim())).length;
  const say = (t: string, kind = '') => { status.textContent = t; status.dataset.kind = kind; };
  const edits = new WeakMap<HTMLElement, number>(); // bumps on every change, so a save knows what changed while it ran
  let autoT = 0, saving: Promise<void> | null = null, again = false;
  const refresh = () => {
    const n = pending();
    saveBtn.disabled = !n;
    saveBtn.textContent = n ? `Save ${n}` : 'Save';
    armedDiscard = false; doneBtn.textContent = 'Done';
    if (n && on) { clearTimeout(autoT); autoT = window.setTimeout(autoSave, 600); }
  };
  // Saving happens by itself a moment after you stop typing (it only writes to this device, so it's quick).
  function autoSave(): Promise<void> {
    clearTimeout(autoT);
    if (saving) { again = true; return saving; }
    if (!pending()) return Promise.resolve();
    saving = save().finally(() => { saving = null; if (again) { again = false; if (pending()) autoSave(); } });
    return saving;
  }
  const flush = async () => { clearTimeout(autoT); for (let i = 0; i < 5 && (saving || pending()); i++) { await autoSave(); if (status.dataset.kind === 'err') return false; } return true; };
  // The page as you see it, for showing again after a reload until it's uploaded and live.
  const snapshot = () => {
    const c = article.cloneNode(true) as HTMLElement;
    c.querySelectorAll('[contenteditable]').forEach((x) => { x.removeAttribute('contenteditable'); x.removeAttribute('spellcheck'); });
    // A running interactive is saved as it was before it started; it starts afresh when the page is shown again.
    c.querySelectorAll('.cast-btn, .cast-row').forEach((x) => x.remove());
    c.querySelectorAll('.sim-root[data-mounted]').forEach((r) => { r.replaceChildren(); r.removeAttribute('data-mounted'); r.removeAttribute('style'); });
    return c.innerHTML;
  };
  (async () => {
    try {
      if (hasPage(slug) && !(await expire(slug))) {
        const h = await loadPage(slug);
        if (h) { article.innerHTML = h; article.dataset.local = ''; document.dispatchEvent(new CustomEvent('cfi:article')); }
      }
    } catch {}
    html.classList.remove('local-wait');
  })();
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const attr = (t: string) => esc(t).replace(/"/g, '&quot;');
  const sel = () => getSelection();
  const selEl = () => { const s = sel(); const n = s?.anchorNode; return n ? (n.nodeType === 1 ? n as HTMLElement : n.parentElement) : null; };
  const markDirty = (n: Element | null) => {
    const el = n?.closest<HTMLElement>('[data-new], [data-src], [data-fm]');
    if (el && el.dataset.new === undefined && !el.dataset.comp) { dirty.add(el); edits.set(el, (edits.get(el) || 0) + 1); }
    refresh();
  };

  /* ---------- on / off ---------- */
  function setEditing(v: boolean) {
    on = v;
    html.classList.toggle('editing', on);
    bar.hidden = head.hidden = !on;
    for (const el of blocks()) {
      if (on) { el.contentEditable = 'true'; el.spellcheck = true; }
      else el.removeAttribute('contenteditable');
    }
    // References, figures and videos inside a block move as one piece.
    article.querySelectorAll<HTMLElement>('.r, .video, svg, .pagelink, .bookmark, .sim').forEach((x) => (on ? (x.contentEditable = 'false') : x.removeAttribute('contenteditable')));
    article.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]').forEach((c) => (c.disabled = !on));
    if (on) say(pending() ? '' : 'Tap any text to edit');
    // An empty page starts with one empty line to type into, like a new Notion page.
    if (on && !article.querySelector(':scope > [data-src], :scope > [data-new]')) {
      const anchor = article.querySelector<HTMLElement>('.meta-line') || article.lastElementChild as HTMLElement;
      const p0 = insertAfterReady(anchor, 'p', {}, undefined, false);
      if (p0) { p0.classList.remove('blk-new'); refresh(); }
    }
    else { pop.hidden = true; say(''); tools.hidden = true; closePanel(); showView('main'); }
  }
  document.querySelectorAll<HTMLElement>('[data-edit-toggle]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
    setEditing(!on);
  }));
  // Checkboxes in to-do lists can be ticked while editing.
  article.addEventListener('change', (e) => { if (on && (e.target as HTMLElement).matches('li > input[type="checkbox"]')) { markDirty(e.target as Element); pushText(); } });

  /* ---------- undo / redo ---------- */
  // Typing uses the browser's own undo; adding, deleting, moving and turning blocks use this stack.
  type Step = { text?: true; undo?: () => void; redo?: () => void };
  const undoStack: Step[] = [], redoStack: Step[] = [];
  let lastEditable: HTMLElement | null = null;
  const pushText = () => { if (undoStack[undoStack.length - 1]?.text !== true) undoStack.push({ text: true }); redoStack.length = 0; };
  const pushStep = (undo: () => void, redo: () => void) => { undoStack.push({ undo, redo }); redoStack.length = 0; };
  function undo() {
    const st = undoStack.pop();
    if (!st) { say('Nothing to undo'); return; }
    if (st.text) { lastEditable?.focus(); document.execCommand('undo'); undoStack.push(st); if (!document.queryCommandEnabled?.('undo')) undoStack.pop(); }
    else st.undo!();
    redoStack.push(st); refresh();
  }
  function redo() {
    const st = redoStack.pop();
    if (!st) { say('Nothing to redo'); return; }
    if (st.text) { lastEditable?.focus(); document.execCommand('redo'); }
    else st.redo!();
    undoStack.push(st); refresh();
  }

  /* ---------- typing ---------- */
  article.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    lastEditable = t.closest<HTMLElement>('[contenteditable="true"]');
    pushText();
    // Typing "/" into an empty text block opens the block list, filtered as you type.
    slashCheck(t.closest<HTMLElement>('[data-new], [data-src]:not([data-comp])'));
    markDirty(t);
    if (!status.dataset.kind) say('');
  });
  article.addEventListener('keydown', (e) => {
    if (!on || e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-fm], summary, .callout-title, figcaption, [data-f="title"], [data-f="channel"], .bm-t')) { e.preventDefault(); return; }
    if (t.closest('pre')) return;
    // Enter on an empty last bullet leaves the list and starts a paragraph, like Notion.
    const li = selEl()?.closest('li');
    const lst = li?.parentElement as HTMLElement | undefined;
    if (li && lst && !li.nextElementSibling && !(li.textContent || '').trim() && (lst.dataset.src || lst.dataset.new !== undefined)) {
      e.preventDefault(); li.remove(); markDirty(lst); insertAfter(lst, 'p'); return;
    }
    if (li && lst?.classList.contains('todo')) {
      // New to-do items get their own checkbox.
      setTimeout(() => lst.querySelectorAll('li').forEach((x) => { if (!x.querySelector(':scope > input')) x.insertAdjacentHTML('afterbegin', '<input type="checkbox" contenteditable="false">'); }));
    }
    const h = t.closest<HTMLElement>('h2, h3, h4');
    if (h && (h.dataset.src || h.dataset.new !== undefined)) { e.preventDefault(); insertAfter(h, 'p'); return; }
    // Enter in a paragraph splits it into two blocks at the cursor, like Notion.
    const para = selEl()?.closest<HTMLElement>('p');
    if (para && para.getAttribute('contenteditable') === 'true' && (para.dataset.src || para.dataset.new !== undefined) && para.dataset.jsx === undefined) {
      const s = sel();
      if (!s?.rangeCount) return;
      e.preventDefault();
      const before = para.innerHTML;
      const r = s.getRangeAt(0); r.deleteContents();
      const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(para, para.childNodes.length);
      const box = document.createElement('div'); box.append(tail.extractContents());
      const restHtml = box.textContent!.trim() ? box.innerHTML.replace(/^\s+/, '') : '';
      const after = para.innerHTML;
      markDirty(para);
      const el = insertAfterReady(para, 'p', {}, restHtml ? [restHtml] : undefined, false);
      if (!el) return;
      pushStep(() => { el.remove(); para.innerHTML = before; refresh(); }, () => { para.innerHTML = after; para.after(el); refresh(); });
      const c = document.createRange(); c.setStart(el, 0); c.collapse(true); s.removeAllRanges(); s.addRange(c);
    }
  });
  // Backspace in an empty paragraph removes it and jumps to the end of the block above.
  article.addEventListener('keydown', (e) => {
    if (!on || e.key !== 'Backspace') return;
    const para = selEl()?.closest<HTMLElement>('p');
    if (!para || para.getAttribute('contenteditable') !== 'true' || (para.textContent || '').length || para.dataset.jsx !== undefined) return;
    let prev = para.previousElementSibling as HTMLElement | null;
    while (prev && prev.dataset.deleted !== undefined) prev = prev.previousElementSibling as HTMLElement | null;
    const target = prev?.matches('[contenteditable="true"]') ? prev : prev?.querySelector<HTMLElement>('[contenteditable="true"]:last-of-type');
    if (!target) return;
    e.preventDefault();
    removeBlock(para, true);
    const leaf = target.querySelector('li:last-child') || target;
    const r = document.createRange(); r.selectNodeContents(leaf); r.collapse(false);
    target.focus(); sel()!.removeAllRanges(); sel()!.addRange(r);
  });
  // A space typed into a toggle's title would open/close the toggle instead of typing.
  article.addEventListener('keydown', (e) => {
    if (on && e.key === ' ' && (e.target as HTMLElement).closest?.('summary')) { e.preventDefault(); document.execCommand('insertText', false, ' '); }
  });
  // Paste as plain text so formatting from other sites doesn't come along.
  article.addEventListener('paste', (e) => {
    if (!on) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
  });

  /* ---------- the bar ---------- */
  let saved: Range | null = null;
  const keepSel = () => { const s = sel(); saved = s && s.rangeCount && article.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : saved; };
  const restoreSel = () => { if (!saved) return false; const s = sel()!; s.removeAllRanges(); s.addRange(saved); return true; };
  document.addEventListener('selectionchange', () => { if (on && article.contains(sel()?.anchorNode || null)) keepSel(); });
  const views = [...bar.querySelectorAll<HTMLElement>('.eb-view')];
  function showView(v: string) { views.forEach((x) => (x.hidden = x.dataset.view !== v)); }
  bar.addEventListener('pointerdown', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) e.preventDefault(); }); // keep the text selection
  head.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('[data-cmd]')) e.preventDefault(); });

  let popMode: 'link' | 'ref' = 'link';
  let popLink: HTMLAnchorElement | null = null; // the link being changed, when the cursor was in one
  const unlinkBtn = pop.querySelector<HTMLButtonElement>('[data-eb-unlink]')!;
  const closePop = () => { pop.hidden = true; popLink = null; restoreSel(); };
  pop.querySelector('[data-eb-close]')!.addEventListener('click', closePop);
  // Remove the link but keep its words.
  unlinkBtn.addEventListener('click', () => {
    const a = popLink; closePop();
    if (!a) return;
    const host = a.parentElement;
    a.replaceWith(...a.childNodes);
    host?.normalize();
    markDirty(host); pushText();
  });
  // Tapping back into the text closes it too.
  article.addEventListener('pointerdown', () => { if (!pop.hidden) { pop.hidden = true; popLink = null; } });
  function openPop(mode: 'link' | 'ref') {
    keepSel();
    if (!saved) { say('Tap into the text first'); return; }
    popMode = mode;
    pop.querySelector('[data-eb-label]')!.textContent = mode === 'link' ? 'Link to' : 'Reference';
    popInput.placeholder = mode === 'link' ? 'https://…' : 'PHAK 5-15; AIM 1-2-3; 14 CFR 91.3';
    const a = mode === 'link' ? (saved.startContainer.parentElement?.closest('a') as HTMLAnchorElement | null) : null;
    popInput.value = a ? a.getAttribute('href') || '' : '';
    popLink = a && article.contains(a) && !a.closest('.r') ? a : null;
    unlinkBtn.hidden = !popLink;
    pop.querySelector<HTMLButtonElement>('[type=submit]')!.textContent = popLink ? 'Update' : 'Add';
    pop.hidden = false;
    popInput.focus();
  }
  pop.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = popInput.value.trim();
    pop.hidden = true;
    if (!restoreSel()) return;
    const host = saved!.startContainer.parentElement;
    if (popMode === 'link') {
      if (popLink && article.contains(popLink)) {
        if (!v) popLink.replaceWith(...popLink.childNodes);
        else popLink.setAttribute('href', /^(https?:|mailto:|\/|#)/.test(v) ? v : `https://${v}`);
        popLink = null;
      } else if (!v) document.execCommand('unlink');
      else {
        const url = /^(https?:|mailto:|\/|#)/.test(v) ? v : `https://${v}`;
        if (saved!.collapsed) document.execCommand('insertHTML', false, `<a href="${attr(url)}">${esc(v)}</a>`);
        else document.execCommand('createLink', false, url);
      }
    } else if (v) {
      document.execCommand('insertHTML', false, ` <span class="r" data-r-to="${attr(v)}" contenteditable="false"><a href="#">${esc(v.replace(/;\s*/g, ' · '))}</a></span>`);
    }
    markDirty(host); pushText();
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

  const fmt = (cmd: string) => {
    restoreSel();
    if (cmd === 'code') {
      const s = sel()!;
      const inCode = selEl()?.closest('code');
      if (inCode) inCode.replaceWith(...inCode.childNodes);
      else if (s.rangeCount && !s.isCollapsed) document.execCommand('insertHTML', false, `<code>${esc(s.toString())}</code>`);
    } else document.execCommand(cmd);
    markDirty(selEl()); pushText();
  };

  async function onCmd(cmd: string) {
    if (cmd !== 'more') moreMenu.hidden = true;
    switch (cmd) {
      case 'bold': case 'italic': case 'underline': case 'strikeThrough': case 'code': fmt(cmd); break;
      case 'text': closePanel(); showView('text'); break;
      case 'back': showView('main'); clearFind(); break;
      case 'find': closePanel(); showView('find'); findInput.focus(); findInput.select(); break;
      case 'findnext': stepFind(1); break;
      case 'findprev': stepFind(-1); break;
      case 'link': case 'ref': openPop(cmd); break;
      case 'add': togglePanel('add'); break;
      case 'turn': togglePanel('turn'); break;
      case 'image': togglePanel('image'); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'kb': (document.activeElement as HTMLElement)?.blur(); closePanel(); break;
      case 'more': moreMenu.hidden = !moreMenu.hidden; break;
      case 'source': openSource(); break;
      case 'delpage': deletePage(); break;
      case 'save': save(); break;
      case 'done':
        (document.activeElement as HTMLElement)?.blur?.();
        if (saving || pending()) { doneBtn.disabled = true; flush().then((ok) => { doneBtn.disabled = false; if (ok) setEditing(false); }); return; }
        setEditing(false);
    }
  }
  bar.addEventListener('click', (e) => { const c = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]')?.dataset.cmd; if (c) onCmd(c); });
  head.addEventListener('click', (e) => { const c = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]')?.dataset.cmd; if (c) onCmd(c); });

  /* ---------- search this page ---------- */
  const findInput = bar.querySelector<HTMLInputElement>('[data-find-input]')!;
  const findN = bar.querySelector<HTMLElement>('[data-find-n]')!;
  let hits: Range[] = [], hitAt = 0;
  const HL = (window as any).Highlight && (CSS as any).highlights;
  function clearFind() { hits = []; findN.textContent = ''; if (HL) { (CSS as any).highlights.delete('find'); (CSS as any).highlights.delete('find-on'); } }
  function runFind(q: string) {
    clearFind();
    q = q.trim().toLowerCase();
    if (q.length < 2) return;
    const walk = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.parentElement?.offsetParent ?? null) !== null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.textContent!.toLowerCase();
      for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.length); hits.push(r); }
    }
    if (HL) (CSS as any).highlights.set('find', new (window as any).Highlight(...hits));
    hitAt = 0; stepFind(0);
  }
  function stepFind(d: number) {
    if (!hits.length) { findN.textContent = findInput.value.trim().length > 1 ? '0' : ''; return; }
    hitAt = (hitAt + d + hits.length) % hits.length;
    findN.textContent = `${hitAt + 1}/${hits.length}`;
    if (HL) (CSS as any).highlights.set('find-on', new (window as any).Highlight(hits[hitAt]));
    const r = hits[hitAt].getBoundingClientRect();
    scrollTo({ top: scrollY + r.top - innerHeight * 0.3, behavior: 'smooth' });
  }
  let ft: number | undefined;
  findInput.addEventListener('input', () => { clearTimeout(ft); ft = window.setTimeout(() => runFind(findInput.value), 120); });
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') onCmd('back'); });

  /* ---------- block catalog (the + sheet, Turn into and "/") ---------- */
  const SV = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  type Item = { id: string; label: string; icon: string; group: string; kind: string; opts?: Record<string, string>; keys?: string; turn?: boolean };
  const CATALOG: Item[] = [
    { id: 'p', label: 'Text', icon: '<b class="ti">T</b>', group: 'Basic blocks', kind: 'p', keys: 'text paragraph plain', turn: true },
    { id: 'h2', label: 'Heading 1', icon: '<b class="th">H<sub>1</sub></b>', group: 'Basic blocks', kind: 'h2', keys: 'heading h1 section title', turn: true },
    { id: 'h3', label: 'Heading 2', icon: '<b class="th">H<sub>2</sub></b>', group: 'Basic blocks', kind: 'h3', keys: 'heading h2 subheading', turn: true },
    { id: 'h4', label: 'Heading 3', icon: '<b class="th">H<sub>3</sub></b>', group: 'Basic blocks', kind: 'h4', keys: 'heading h3 small', turn: true },
    { id: 'ul', label: 'Bulleted list', icon: SV('<circle cx="5" cy="7" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="5" cy="17" r="1.5"/><path d="M10 7h10M10 12h10M10 17h10"/>'), group: 'Basic blocks', kind: 'ul', keys: 'bullets bulleted list', turn: true },
    { id: 'ol', label: 'Numbered list', icon: SV('<path d="M4 6h2v5M4 11h3M10 7h10M10 12h10M10 17h10M4 15h3l-3 4h3"/>'), group: 'Basic blocks', kind: 'ol', keys: 'numbered ordered list steps', turn: true },
    { id: 'todo', label: 'To-do list', icon: SV('<path d="m3 7 2 2 3-3M3 15l2 2 3-3M11 8h10M11 16h10"/>'), group: 'Basic blocks', kind: 'todo', keys: 'todo to-do checklist checkbox', turn: true },
    { id: 'toggle', label: 'Toggle list', icon: SV('<path d="m4 6 4 3-4 3zM11 9h10M11 16h10"/>'), group: 'Basic blocks', kind: 'toggle', keys: 'toggle collapse dropdown', turn: true },
    { id: 'quote', label: 'Quote', icon: '<b class="tq">“</b>', group: 'Basic blocks', kind: 'quote', keys: 'quote blockquote', turn: true },
    { id: 'note', label: 'Callout', icon: SV('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h10M7 14h6"/>'), group: 'Basic blocks', kind: 'callout', opts: { k: 'note' }, keys: 'callout note info', turn: true },
    { id: 'table', label: 'Table', icon: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M3 15h18M10 5v14"/>'), group: 'Basic blocks', kind: 'table', keys: 'table grid' },
    { id: 'hr', label: 'Divider', icon: SV('<path d="M4 12h16"/>'), group: 'Basic blocks', kind: 'hr', keys: 'divider line separator rule' },
    { id: 'pagelink', label: 'Link to page', icon: SV('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M10 15l4-4M11 11h3v3"/>'), group: 'Basic blocks', kind: 'pagelink', keys: 'link page lesson' },
    { id: 'code', label: 'Code', icon: SV('<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>'), group: 'Basic blocks', kind: 'code', keys: 'code block monospace', turn: true },

    { id: 'teach', label: 'Teaching tip', icon: '<b>🎓</b>', group: 'Binder', kind: 'callout', opts: { k: 'teach' }, keys: 'teaching tip callout teach', turn: true },
    { id: 'fleet', label: 'Our airplanes', icon: '<b>✈️</b>', group: 'Binder', kind: 'callout', opts: { k: 'fleet' }, keys: 'our airplanes fleet aircraft callout', turn: true },
    { id: 'warn', label: 'Warning', icon: '<b>⚠️</b>', group: 'Binder', kind: 'callout', opts: { k: 'warn' }, keys: 'warning caution callout', turn: true },
    { id: 'acs', label: 'ACS standard', icon: '<b>✅</b>', group: 'Binder', kind: 'callout', opts: { k: 'acs' }, keys: 'acs standard callout', turn: true },
    { id: 'compare', label: 'C172 vs PA-28', icon: '<b class="tx">⇆</b>', group: 'Binder', kind: 'compare', keys: 'c172 pa28 pa-28 cessna piper compare cards aircraft' },
    { id: 'lv-irca', label: 'Instrument + Commercial only', icon: '<b class="tx">IR·CA</b>', group: 'Binder', kind: 'level', opts: { lv: 'ir ca' }, keys: 'level only ir ca instrument commercial', turn: true },
    { id: 'lv-ir', label: 'Instrument only', icon: '<b class="tx">IR</b>', group: 'Binder', kind: 'level', opts: { lv: 'ir' }, keys: 'level only ir instrument', turn: true },
    { id: 'lv-ca', label: 'Commercial only', icon: '<b class="tx">CA</b>', group: 'Binder', kind: 'level', opts: { lv: 'ca' }, keys: 'level only ca commercial', turn: true },
    { id: 'pn-analog', label: 'Round dials only', icon: '<b class="tx">DIAL</b>', group: 'Binder', kind: 'panel', opts: { p: 'analog' }, keys: 'round dials analog steam gauges panel six pack', turn: true },
    { id: 'pn-glass', label: 'Glass panel only', icon: '<b class="tx">GLASS</b>', group: 'Binder', kind: 'panel', opts: { p: 'glass' }, keys: 'glass g1000 pfd panel avionics', turn: true },
    { id: 'pn-keep', label: 'Round dials, every panel', icon: '<b class="tx">DIAL+</b>', group: 'Binder', kind: 'panel', opts: { p: 'analog keep' }, keys: 'round dials partial panel standby faa every panel', turn: true },
    { id: 'lv-pa', label: 'Private only', icon: '<b class="tx">PVT</b>', group: 'Binder', kind: 'level', opts: { lv: 'pa' }, keys: 'level only pvt private', turn: true },

    { id: 'image', label: 'Image', icon: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>'), group: 'Media', kind: 'image', keys: 'image picture photo' },
    { id: 'video', label: 'Video', icon: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>'), group: 'Media', kind: 'video', keys: 'video youtube' },
    { id: 'audio', label: 'Audio', icon: SV('<path d="M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'), group: 'Media', kind: 'audio', keys: 'audio sound mp3' },
    { id: 'file', label: 'File', icon: SV('<path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/>'), group: 'Media', kind: 'file', keys: 'file pdf attachment upload' },
    { id: 'bookmark', label: 'Web bookmark', icon: SV('<path d="M6 3h12v18l-6-4-6 4z"/>'), group: 'Media', kind: 'bookmark', keys: 'web bookmark link website' },

    { id: 'embed', label: 'Embed', icon: SV('<path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M9 15l6-6"/>'), group: 'Embeds', kind: 'embed', keys: 'embed iframe website' },
    { id: 'maps', label: 'Google Maps', icon: '<b>🗺️</b>', group: 'Embeds', kind: 'embed', opts: { hint: 'maps' }, keys: 'google maps map airport' },
    { id: 'drive', label: 'Google Drive', icon: '<b>📁</b>', group: 'Embeds', kind: 'embed', opts: { hint: 'drive' }, keys: 'google drive doc sheet slides' },

    { id: 'th1', label: 'Toggle heading 1', icon: '<b class="th">▸H<sub>1</sub></b>', group: 'Advanced blocks', kind: 'toggle', opts: { h: '1' }, keys: 'toggle heading 1', turn: true },
    { id: 'th2', label: 'Toggle heading 2', icon: '<b class="th">▸H<sub>2</sub></b>', group: 'Advanced blocks', kind: 'toggle', opts: { h: '2' }, keys: 'toggle heading 2', turn: true },
    { id: 'th3', label: 'Toggle heading 3', icon: '<b class="th">▸H<sub>3</sub></b>', group: 'Advanced blocks', kind: 'toggle', opts: { h: '3' }, keys: 'toggle heading 3', turn: true },
    { id: 'col2', label: '2 columns', icon: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>'), group: 'Advanced blocks', kind: 'columns', opts: { n: '2' }, keys: 'columns 2 two side' },
    { id: 'col3', label: '3 columns', icon: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14M15 5v14"/>'), group: 'Advanced blocks', kind: 'columns', opts: { n: '3' }, keys: 'columns 3 three' },
  ];
  const IMAGE_ITEMS = [
    { id: 'img-lib', label: 'Photos', sub: 'Choose from your library', icon: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>') },
    { id: 'img-cam', label: 'Camera', sub: 'Take a photo', icon: SV('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>') },
    { id: 'img-url', label: 'From a link', sub: 'Paste a picture’s web address', icon: SV('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>') },
  ];

  /* ---------- the sheet under the bar ---------- */
  let panelMode = '';
  const panelH = panel.querySelector<HTMLElement>('[data-panel-h]')!;
  const panelBody = panel.querySelector<HTMLElement>('[data-panel-body]')!;
  function closePanel() { panel.hidden = true; panelMode = ''; html.classList.remove('panel-open'); bar.querySelectorAll('[data-cmd].on').forEach((b) => b.classList.remove('on')); }
  function togglePanel(mode: string) {
    if (panelMode === mode) { closePanel(); return; }
    keepSel();
    if (!current) current = selEl()?.closest<HTMLElement>('[data-new], [data-src]') || null;
    if (mode === 'turn' && !current) { say('Tap a block first'); return; }
    if (!current) current = lastTop();
    panelMode = mode;
    bar.querySelectorAll('[data-cmd]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.cmd === (mode === 'add' ? 'add' : mode)));
    (document.activeElement as HTMLElement)?.blur(); // the sheet takes the keyboard's place
    if (mode === 'image') {
      panelH.textContent = 'Add a picture';
      panelBody.innerHTML = `<div class="panel-list">${IMAGE_ITEMS.map((i) => `<button type="button" data-img="${i.id}">${i.icon}<span><b>${i.label}</b><small>${i.sub}</small></span></button>`).join('')}</div>`;
    } else if (mode === 'pages') {
      panelH.textContent = 'Link to page';
      panelBody.innerHTML = outline.map((a) => `<p class="panel-g">${esc(a.title)}</p><div class="panel-list">${pagesIn(a.topics).filter((t) => t.slug).map((t) => `<button type="button" data-page="${t.slug}">${SV('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>')}<span><b>${esc(t.title)}</b></span></button>`).join('') || '<p class="muted small">No pages yet</p>'}</div>`).join('');
    } else {
      const canTurn = mode !== 'turn' || turnable(current);
      const list = mode === 'turn' ? (canTurn ? CATALOG.filter((i) => i.turn) : []) : CATALOG;
      panelH.textContent = mode === 'turn' ? (canTurn ? 'Turn into' : 'This block') : '';
      const groups = [...new Set(list.map((i) => i.group))];
      // The block's own actions sit at the top of Turn into (phones have no hover handles).
      const acts = mode === 'turn' ? `<div class="panel-acts"><button type="button" data-act="up">${SV('<path d="M12 19V5M6 11l6-6 6 6"/>')}Move up</button><button type="button" data-act="down">${SV('<path d="M12 5v14M6 13l6 6 6-6"/>')}Move down</button><button type="button" data-act="del" class="danger">${SV('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>')}Delete</button></div>` : '';
      panelBody.innerHTML = acts + groups.map((g) => `${mode === 'turn' && g === 'Basic blocks' ? '' : `<p class="panel-g">${g}</p>`}<div class="panel-grid">${list.filter((i) => i.group === g).map((i) => `<button type="button" data-item="${i.id}"><span class="pi">${i.icon}</span>${i.label}</button>`).join('')}</div>`).join('');
    }
    panel.hidden = false; panel.scrollTop = 0;
    html.classList.add('panel-open');
  }
  panel.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
  panel.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const at = current && article.contains(current) ? current : lastTop();
    const mode = panelMode;
    if (b.dataset.page) { closePanel(); if (at) insertAfter(at, 'pagelink', { to: b.dataset.page }); return; }
    if (b.dataset.img) { closePanel(); if (at) addImage(at, b.dataset.img); return; }
    if (b.dataset.act && at) { closePanel(); if (b.dataset.act === 'del') removeBlock(at); else move(at, b.dataset.act === 'up' ? -1 : 1); return; }
    const it = CATALOG.find((i) => i.id === b.dataset.item);
    if (!it || !at) return;
    if (it.kind === 'pagelink') { panelMode = ''; togglePanel('pages'); return; }
    closePanel();
    if (mode === 'turn') turnInto(at, it);
    else insertAfter(at, it.kind, { ...(it.opts || {}) });
  });
  document.addEventListener('pointerdown', (e) => {
    if (panel.hidden) return;
    const t = e.target as HTMLElement;
    if (!panel.contains(t) && !bar.contains(t)) closePanel();
  });

  /* ---------- "/" quick add: type /bul, /c172, /warn… and Enter ---------- */
  const slash = document.createElement('div');
  slash.className = 'slash-menu'; slash.hidden = true; slash.setAttribute('role', 'listbox');
  document.body.append(slash);
  let slashFrom: HTMLElement | null = null;
  let slashHits: Item[] = [];
  let slashSel = 0;
  const words = (i: Item) => `${i.label} ${i.keys || ''}`.toLowerCase();
  function slashCheck(blk: HTMLElement | null) {
    const m = blk && /^(P|DIV)$/.test(blk.tagName) ? (blk.textContent || '').match(/^\/([^/\n]{0,24})$/) : null;
    if (!m) { slash.hidden = true; return; }
    slashFrom = blk;
    const q = m[1].toLowerCase().trim().split(/\s+/).filter(Boolean);
    slashHits = CATALOG.filter((it) => q.every((w) => words(it).split(/[\s·+]+/).some((x) => x.startsWith(w)) || words(it).includes(w)));
    slashSel = 0;
    // Like Notion: once nothing matches, the menu goes away and what you typed stays as text.
    if (!slashHits.length) { slash.hidden = true; return; }
    slash.innerHTML = slashHits.map((it, i) => `<button type="button" role="option" data-i="${i}" class="${i === 0 ? 'on' : ''}"><span class="pi">${it.icon}</span>${it.label}</button>`).join('');
    slash.hidden = false;
    // Below the line when there's room above the bar/keyboard, else above it; never over the top bar.
    const r = blk!.getBoundingClientRect();
    const bottom = (window.visualViewport?.height || innerHeight) - (bar.offsetHeight || 50) - 8;
    const spaceBelow = bottom - r.bottom - 6, spaceAbove = r.top - 64;
    const below = spaceBelow >= 160 || spaceBelow >= spaceAbove;
    const maxH = Math.max(120, Math.min(300, below ? spaceBelow : spaceAbove));
    slash.style.maxHeight = `${maxH}px`;
    slash.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 268)) + scrollX}px`;
    slash.style.top = `${(below ? r.bottom + 6 : r.top - 6 - Math.min(slash.offsetHeight, maxH)) + scrollY}px`;
  }
  function slashPick(i: number) {
    const it = slashHits[i];
    slash.hidden = true;
    const from = slashFrom; slashFrom = null;
    if (!it || !from) return;
    if (it.kind === 'pagelink') { current = from; from.textContent = ''; togglePanel('pages'); return; }
    if (from.dataset.new !== undefined) { const prev = from.previousElementSibling as HTMLElement; from.remove(); insertAfter(prev, it.kind, { ...(it.opts || {}) }); }
    else { from.textContent = ''; removeBlock(from, true); insertAfter(from, it.kind, { ...(it.opts || {}) }); }
  }
  slash.addEventListener('pointerdown', (e) => e.preventDefault());
  slash.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]'); if (b) slashPick(Number(b.dataset.i)); });
  article.addEventListener('keydown', (e) => {
    if (slash.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      slashSel = (slashSel + (e.key === 'ArrowDown' ? 1 : -1) + slashHits.length) % Math.max(1, slashHits.length);
      slash.querySelectorAll('[data-i]').forEach((b, i) => b.classList.toggle('on', i === slashSel));
      slash.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === 'Tab') { if (slashHits.length) { e.preventDefault(); e.stopImmediatePropagation(); slashPick(slashSel); } }
    else if (e.key === 'Escape') { slash.hidden = true; }
  }, true);
  article.addEventListener('focusout', () => setTimeout(() => { if (!article.contains(document.activeElement)) slash.hidden = true; }, 150));

  /* ---------- turning the page back into MDX ---------- */
  const mdText = (t: string) => t.replace(/ /g, ' ').replace(/\\/g, '\\\\').replace(/([*_`[\]{}<~])/g, '\\$1');
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
      if (tag === 'input') return;
      const inner = inline(el, jsx);
      if (!inner.trim()) { out += inner; return; }
      if (tag === 'strong' || tag === 'b') out += jsx ? `<strong>${inner}</strong>` : wrap('**', inner);
      else if (tag === 'em' || tag === 'i') out += jsx ? `<em>${inner}</em>` : wrap('*', inner);
      else if (tag === 's' || tag === 'strike' || tag === 'del') out += jsx ? `<s>${inner}</s>` : wrap('~~', inner);
      else if (tag === 'u') out += `<u>${inner}</u>`;
      else if (tag === 'code') out += '`' + (el.textContent || '').replace(/`/g, '') + '`';
      else if (tag === 'a') out += jsx ? `<a href="${attr(el.getAttribute('href') || '')}">${inner}</a>` : `[${inner}](${(el.getAttribute('href') || '').replace(/[()\s]/g, encodeURIComponent)})`;
      else if (tag === 'sub' || tag === 'sup') out += `<${tag}>${inner}</${tag}>`;
      else if (tag === 'span' && /text-decoration:\s*underline/.test(el.getAttribute('style') || '')) out += `<u>${inner}</u>`;
      else if (tag === 'span' && /line-through/.test(el.getAttribute('style') || '')) out += wrap('~~', inner);
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
    return [...el.children].filter((li) => li.tagName === 'LI').map((li) => {
      const own = document.createElement('span');
      const subs: string[] = [];
      const cb = li.querySelector<HTMLInputElement>(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
      li.childNodes.forEach((n) => {
        if (n.nodeType === 1 && /^(UL|OL)$/.test((n as HTMLElement).tagName)) subs.push(list(n as HTMLElement, depth + 1));
        else own.append(n.cloneNode(true));
      });
      const t = oneLine(inline(own));
      const box = cb || el.classList.contains('todo') ? `[${cb?.checked ? 'x' : ' '}] ` : '';
      return t || subs.length ? `${pad}${ordered ? '1.' : '-'} ${box}${t}${subs.length ? '\n' + subs.join('\n') : ''}` : '';
    }).filter(Boolean).map((l, i) => (ordered ? l.replace(/^(\s*)\d+\./, `$1${i + 1}.`) : l)).join('\n');
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
  const optAttr = (name: string, v: string) => (v ? ` ${name}="${jsxAttr(v)}"` : '');
  const LV: Record<string, string> = { pa: 'Private', ir: 'Instrument', ca: 'Commercial' };
  const BUILD: Record<string, (el: HTMLElement) => string> = {
    raw: (el) => el.dataset.raw || '',
    hr: () => '---',
    code: (el) => '```\n' + (el.innerText || '').replace(/\n$/, '') + '\n```',
    callout: (el) => `<Callout kind="${el.dataset.k}"${optAttr('title', plain(field(el, 'title')))}>\n\n${body(field(el, 'body'))}\n\n</Callout>`,
    compare: (el) => `<Compare>\n  <Fragment slot="c172">\n\n${body(field(el, 'c172'))}\n\n  </Fragment>\n  <Fragment slot="pa28">\n\n${body(field(el, 'pa28'))}\n\n  </Fragment>\n</Compare>`,
    level: (el) => `<Level ${el.dataset.lv}>\n\n${body(field(el, 'body'))}\n\n</Level>`,
    panel: (el) => `<Panel ${el.dataset.p}>\n\n${body(field(el, 'body'))}\n\n</Panel>`,
    toggle: (el) => `<Toggle title="${jsxAttr(plain(field(el, 'title')) || 'More')}"${el.dataset.h ? ` heading={${el.dataset.h}}` : ''}>\n\n${body(field(el, 'body'))}\n\n</Toggle>`,
    video: (el) => `<Video youtube="${el.dataset.yt}" title="${jsxAttr(plain(field(el, 'title')) || 'Video')}"${optAttr('channel', plain(field(el, 'channel')))} />`,
    image: (el) => `<Figure caption="${jsxAttr(plain(field(el, 'caption')))}"${optAttr('credit', plain(field(el, 'credit')))}>\n  <img src="${jsxAttr(el.dataset.url || '')}" alt="${jsxAttr(plain(field(el, 'caption')))}" />\n</Figure>`,
    audio: (el) => `<audio controls src="${jsxAttr(el.dataset.url || '')}"></audio>`,
    file: (el) => `<FileLink href="${jsxAttr(el.dataset.url || '')}"${optAttr('name', plain(field(el, 'title')))} />`,
    bookmark: (el) => `<Bookmark href="${jsxAttr(el.dataset.url || '')}"${optAttr('title', plain(field(el, 'title')))}${optAttr('note', plain(field(el, 'note')))} />`,
    embed: (el) => `<Embed src="${jsxAttr(el.dataset.url || '')}"${optAttr('title', plain(field(el, 'title')))} />`,
    pagelink: (el) => `<PageLink to="${el.dataset.to}" />`,
    columns: (el) => `<Columns n={${el.dataset.n}}>\n${[...el.querySelectorAll<HTMLElement>('[data-f^="c"]')].map((c) => `<Col>\n\n${body(c)}\n\n</Col>`).join('\n')}\n</Columns>`,
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

  /* ---------- new blocks ---------- */
  const ED = 'contenteditable="true" data-ed';
  const ph = (t: string) => `data-ph="${t}"`;
  type Content = string[]; // inline HTML for each line carried over by Turn into
  const paras = (c: Content | undefined, f: string, place: string) => (c?.length ? c : ['']).map((h, i) => `<p ${ED}${i === 0 ? ` data-f="${f}"` : ''} ${ph(place)}>${h}</p>`).join('');
  const bodyBox = (c: Content | undefined, place: string) => `<div ${ED} data-f="body" ${ph(place)}>${(c || []).map((h) => `<p>${h}</p>`).join('') || ''}</div>`;
  const TEMPLATES: Record<string, (o: Record<string, string>, c?: Content) => string> = {
    p: (_, c) => `<p ${ED} ${ph('Type, or / for blocks')}>${c?.join(' ') || ''}</p>`,
    h2: (_, c) => `<h2 ${ED} ${ph('Heading 1')}>${c?.join(' ') || ''}</h2>`,
    h3: (_, c) => `<h3 ${ED} ${ph('Heading 2')}>${c?.join(' ') || ''}</h3>`,
    h4: (_, c) => `<h4 ${ED} ${ph('Heading 3')}>${c?.join(' ') || ''}</h4>`,
    ul: (_, c) => `<ul ${ED}>${(c?.length ? c : ['']).map((h) => `<li>${h}</li>`).join('')}</ul>`,
    ol: (_, c) => `<ol ${ED}>${(c?.length ? c : ['']).map((h) => `<li>${h}</li>`).join('')}</ol>`,
    todo: (_, c) => `<ul class="todo" ${ED}>${(c?.length ? c : ['']).map((h) => `<li><input type="checkbox" contenteditable="false">${h}</li>`).join('')}</ul>`,
    quote: (_, c) => `<blockquote ${ED} ${ph('Quote')}>${c?.join('<br>') || ''}</blockquote>`,
    code: (_, c) => `<pre ${ED} ${ph('Code')}>${(c || []).map((h) => esc(new DOMParser().parseFromString(h, 'text/html').body.textContent || '')).join('\n')}</pre>`,
    table: () => `<table ${ED}><thead><tr><th>Item</th><th>C172</th><th>PA-28-181</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr></tbody></table>`,
    hr: () => `<hr>`,
    callout: (o, c) => `<aside class="callout ${o.k}"><span class="callout-icon" aria-hidden="true">${({ teach: '🎓', fleet: '✈️', warn: '⚠️', acs: '✅', note: '💡' } as any)[o.k]}</span><div class="callout-body"><p class="callout-title" ${ED} data-f="title" ${ph('Title (optional)')}></p>${bodyBox(c, 'What to say')}</div></aside>`,
    compare: () => `<div class="compare"><div class="ac-card" data-only="c172"><p class="ac-name">Cessna 172</p><ul ${ED} data-f="c172"><li></li></ul></div><div class="ac-card" data-only="pa28"><p class="ac-name">Piper PA-28-181</p><ul ${ED} data-f="pa28"><li></li></ul></div></div>`,
    panel: (o, c) => `<div class="pnl" data-panel-only="${o.p.split(' ')[0]}"><p class="pnl-tag">${o.p === 'glass' ? 'Glass panel' : o.p.includes('keep') ? 'Round dials · teach on every panel' : 'Round dials'}</p>${bodyBox(c, 'Shows only for this panel')}</div>`,
    level: (o, c) => `<div class="lvl-preview"><p class="lvl-tag">${o.lv.split(' ').map((k) => LV[k]).join(' · ')} only</p>${bodyBox(c, 'Shows only at this level')}</div>`,
    toggle: (o, c) => `<details class="toggle${o.h ? ` toggle-h${o.h}` : ''}" open><summary ${ED} data-f="title" ${ph(o.h ? 'Toggle heading' : 'Toggle')}>${o.h && c?.length ? c.join(' ') : ''}</summary><div class="toggle-body">${bodyBox(o.h ? [] : c, 'Hidden until tapped')}</div></details>`,
    video: (o) => `<div class="video-frame" style="background:#000 url(https://i.ytimg.com/vi/${o.yt}/hqdefault.jpg) center/cover"></div><figcaption><strong ${ED} data-f="title" ${ph('Video title')}></strong> · <span ${ED} data-f="channel" ${ph('Channel')}></span></figcaption>`,
    image: (o) => `<div class="figure-art"><img src="${attr(o.preview || o.url)}" alt=""></div><figcaption><span ${ED} data-f="caption" ${ph('Caption')}></span> <span class="credit" ${ED} data-f="credit" ${ph('Source')}></span></figcaption>`,
    audio: (o) => `<audio controls src="${attr(o.preview || o.url)}"></audio>`,
    file: (o) => `<span class="filelink">${SV('<path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/>')}<span ${ED} data-f="title" ${ph('File name')}>${esc(o.name || '')}</span></span>`,
    bookmark: (o) => `<span class="bm-t" ${ED} data-f="title" ${ph('Title')}></span><span class="bm-n" ${ED} data-f="note" ${ph('Note (optional)')}></span><span class="bm-h">${esc(o.host)}</span>`,
    embed: (o) => `<div class="embed-load"><span class="embed-t" ${ED} data-f="title" ${ph('Title')}></span><span class="muted small">${esc(o.host)}</span></div>`,
    pagelink: (o) => `${SV('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>')}<span>${esc(pagesIn(outline).find((t) => t.slug === o.to)?.title || o.to)}</span>`,
    columns: (o) => Array.from({ length: Number(o.n) }, (_, i) => `<div class="col">${`<div ${ED} data-f="c${i}" ${ph(`Column ${i + 1}`)}></div>`}</div>`).join(''),
  };
  const WRAP: Record<string, string> = { callout: 'div', compare: 'div', level: 'div', panel: 'div', toggle: 'div', video: 'figure', image: 'figure', audio: 'div', file: 'div', bookmark: 'div', embed: 'figure', pagelink: 'div', columns: 'div', code: '' };
  const WRAP_CLASS: Record<string, string> = { video: 'video', image: 'figure', bookmark: 'bookmark', embed: 'embed', pagelink: 'pagelink', columns: 'columns' };

  const askFor = (label: string, phText: string) => new Promise<string | null>((ok) => {
    pop.querySelector('[data-eb-label]')!.textContent = label;
    popInput.placeholder = phText; popInput.value = ''; pop.hidden = false; popInput.focus();
    const done = (v: string | null) => { pop.hidden = true; pop.removeEventListener('submit', sub, true); ok(v); };
    const sub = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); done(popInput.value.trim() || null); };
    pop.addEventListener('submit', sub, true);
    popInput.addEventListener('keydown', function escK(e) { if (e.key === 'Escape') { popInput.removeEventListener('keydown', escK); done(null); } });
  });
  const pickFile = (accept: string, capture = false) => new Promise<File | null>((ok) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
    if (capture) inp.setAttribute('capture', 'environment');
    inp.onchange = () => ok(inp.files?.[0] || null); inp.click();
  });
  async function shrink(f: File) {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  }
  const readAsDataUrl = (f: File) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(f); });
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const asUrl = (v: string) => (/^https?:\/\//.test(v) ? v : `https://${v}`);

  async function addImage(at: HTMLElement, how: string) {
    if (how === 'img-url') { const v = await askFor('Picture link', 'https://…'); if (v) insertAfter(at, 'image', { url: asUrl(v) }); return; }
    const f = await pickFile('image/*', how === 'img-cam'); if (!f) return;
    const data = await shrink(f);
    insertAfter(at, 'image', { preview: data, upload: data, ext: 'jpg' });
  }

  async function insertAfter(at: HTMLElement, kind: string, opts: Record<string, string> = {}, content?: Content, record = true): Promise<HTMLElement | null> {
    const o = { ...opts };
    // Ask for what the block needs first.
    if (kind === 'video') {
      const v = await askFor('YouTube link', 'https://youtu.be/…');
      const id = v?.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/)?.[1] || (v && /^[\w-]{11}$/.test(v) ? v : null);
      if (!id) { if (v) say('That isn’t a YouTube link', 'err'); return null; }
      o.yt = id;
    }
    if (kind === 'image' && !o.url && !o.preview) {
      const v = await askFor('Picture link (or use the picture button for photos)', 'https://…');
      if (!v) { addImage(at, 'img-lib'); return null; }
      o.url = asUrl(v);
    }
    if (kind === 'audio' || kind === 'file') {
      const v = await askFor(kind === 'audio' ? 'Audio link, or leave empty to upload' : 'File link, or leave empty to upload', 'https://… (empty = choose a file)');
      if (v) { o.url = asUrl(v); o.name = decodeURIComponent(o.url.split('/').pop() || ''); }
      else {
        const f = await pickFile(kind === 'audio' ? 'audio/*' : '*/*'); if (!f) return null;
        if (f.size > 20e6) { say('That file is over 20 MB', 'err'); return null; }
        o.preview = await readAsDataUrl(f); o.upload = o.preview; o.name = f.name; o.ext = (f.name.split('.').pop() || 'bin').toLowerCase();
      }
    }
    if (kind === 'bookmark' || kind === 'embed') {
      const hint = o.hint === 'maps' ? 'Google Maps: Share › Embed a map › copy the link' : o.hint === 'drive' ? 'Google Drive file link (shared “anyone with the link”)' : kind === 'bookmark' ? 'Web address' : 'Web address to embed';
      const v = await askFor(hint, 'https://…');
      if (!v) return null;
      let url = asUrl((v.match(/src="([^"]+)"/) || [])[1] || v); // a pasted <iframe> works too
      if (kind === 'embed') {
        const yt = url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
        if (yt) { return insertAfterReady(at, 'video', { yt: yt[1] }, content, record); }
        url = url.replace(/(drive|docs)\.google\.com\/(.*)\/(view|edit)(\?.*)?$/, '$1.google.com/$2/preview');
      }
      o.url = url; o.host = hostOf(url);
    }
    return insertAfterReady(at, kind, o, content, record);
  }
  function insertAfterReady(at: HTMLElement, kind: string, o: Record<string, string>, content: Content | undefined, record: boolean) {
    const tpl = TEMPLATES[kind];
    if (!tpl) return null;
    const holder = document.createElement('div');
    const w = WRAP[kind];
    holder.innerHTML = w ? `<${w}>${tpl(o, content)}</${w}>` : tpl(o, content);
    const el = holder.firstElementChild as HTMLElement;
    el.dataset.new = '';
    el.classList.add('blk-new');
    if (WRAP_CLASS[kind]) el.classList.add(WRAP_CLASS[kind]);
    if (w !== undefined || kind === 'hr') { el.dataset.kind = kind; if (w) el.contentEditable = 'false'; }
    for (const k of ['k', 'lv', 'p', 'yt', 'h', 'n', 'to', 'url', 'upload', 'ext', 'name']) if (o[k]) el.dataset[k] = o[k];
    el.querySelectorAll('summary').forEach((x) => x.addEventListener('click', (e) => { if (on) e.preventDefault(); }));
    at.after(el);
    if (record) pushStep(() => { el.remove(); refresh(); }, () => { at.after(el); refresh(); });
    refresh(); say('');
    const first = el.matches('[data-ed]') ? el : el.querySelector<HTMLElement>('[data-ed]');
    if (first) {
      const target = first.querySelector('li:last-child, td') || (first.lastElementChild?.tagName === 'P' ? first.lastElementChild : null) || first;
      const r = document.createRange(); r.selectNodeContents(target); r.collapse(false);
      first.focus(); sel()!.removeAllRanges(); sel()!.addRange(r);
    }
    current = el; place(el);
    el.scrollIntoView({ block: 'nearest' });
    return el;
  }

  /* ---------- turn into ---------- */
  const TURNABLE = /^(P|H2|H3|H4|UL|OL|BLOCKQUOTE|PRE)$/;
  function turnable(el: HTMLElement | null) { return !!el && (TURNABLE.test(el.tagName) || ['callout', 'toggle', 'level', 'panel'].includes(el.dataset.kind || '')) && el.dataset.jsx === undefined && !el.dataset.comp; }
  function contentOf(el: HTMLElement): Content {
    const pick = (x: Element) => [...x.childNodes].filter((n) => !(n.nodeType === 1 && (n as HTMLElement).matches('input, ul, ol'))).map((n) => (n.nodeType === 1 ? (n as HTMLElement).outerHTML : esc(n.textContent || ''))).join('').trim();
    if (el.dataset.kind) { const b = el.querySelector<HTMLElement>('[data-f="body"]'); const t = el.querySelector<HTMLElement>('[data-f="title"]'); const lines = [...(b?.querySelectorAll('p') || [])].map((p) => p.innerHTML).filter(Boolean); if (b && !lines.length && b.textContent?.trim()) lines.push(b.innerHTML); return [t?.innerHTML || '', ...lines].filter(Boolean); }
    if (el.tagName === 'UL' || el.tagName === 'OL') return [...el.querySelectorAll(':scope > li')].map(pick).filter(Boolean);
    if (el.tagName === 'PRE') return (el.textContent || '').split('\n').map(esc);
    if (el.tagName === 'BLOCKQUOTE') { const ps = [...el.querySelectorAll('p')]; return ps.length ? ps.map((p) => p.innerHTML) : [el.innerHTML]; }
    const inner = [...el.childNodes].filter((n) => !(n.nodeType === 1 && /^(DIV|P)$/.test((n as HTMLElement).tagName)));
    const extra = [...el.childNodes].filter((n) => n.nodeType === 1 && /^(DIV|P)$/.test((n as HTMLElement).tagName)).map((n) => (n as HTMLElement).innerHTML);
    const h = document.createElement('span'); inner.forEach((n) => h.append(n.cloneNode(true)));
    return [h.innerHTML.trim(), ...extra].filter(Boolean);
  }
  async function turnInto(el: HTMLElement, it: Item) {
    const c = contentOf(el);
    const made = await insertAfter(el, it.kind, { ...(it.opts || {}) }, it.kind === 'p' && c.length > 1 ? [c[0]] : c, false);
    if (!made) return;
    // Text turned into text keeps one paragraph per line.
    const extra: HTMLElement[] = [];
    if (it.kind === 'p' && c.length > 1) { let prev = made; for (const h of c.slice(1)) { const x = insertAfterReady(prev, 'p', {}, [h], false)!; extra.push(x); prev = x; } }
    const wasNew = el.dataset.new !== undefined;
    const ph0 = el.previousElementSibling;
    if (wasNew) el.remove(); else { el.dataset.deleted = ''; dirty.delete(el); }
    pushStep(
      () => { made.remove(); extra.forEach((x) => x.remove()); if (wasNew) (ph0 ? ph0.after(el) : article.prepend(el)); else delete el.dataset.deleted; refresh(); },
      () => { el.after(made); let p = made; extra.forEach((x) => { p.after(x); p = x; }); if (wasNew) el.remove(); else el.dataset.deleted = ''; refresh(); },
    );
    refresh();
  }

  /* ---------- block handles: add, move, delete ---------- */
  const target = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>('[data-new], [data-src]') : null);
  const lastTop = () => [...article.querySelectorAll<HTMLElement>(':scope > [data-src], :scope > [data-new]')].filter((x) => x.dataset.deleted === undefined).pop() || null;
  function place(el: HTMLElement | null) {
    if (el) current = el;
    if (!on || !el || el.dataset.deleted !== undefined || !matchMedia('(hover: hover) and (pointer: fine)').matches) { tools.hidden = true; return; }
    const r = el.getBoundingClientRect(), a = article.getBoundingClientRect();
    tools.hidden = false;
    const wide = a.left > 70;
    tools.classList.toggle('inside', !wide);
    tools.style.top = `${r.top + scrollY + (wide ? 2 : -34)}px`;
    tools.style.left = wide ? `${a.left - 64}px` : `${Math.min(r.right, a.right) - tools.offsetWidth + scrollX}px`;
  }
  article.addEventListener('pointerover', (e) => { if (on && matchMedia('(hover: hover)').matches) { const t = target(e.target); if (t && t !== current) place(t); } });
  article.addEventListener('focusin', (e) => { if (on) { place(target(e.target)); lastEditable = (e.target as HTMLElement).closest<HTMLElement>('[contenteditable="true"]'); } });
  article.addEventListener('click', (e) => { if (on) { const t = target(e.target); if (t) place(t); } });
  // Tap in empty space while editing: put the cursor on that line, like Notion. Below the last block,
  // that's a new empty line (or the empty one already there).
  const mainEl = article.closest('main') || document.body;
  const caretAt = (el: HTMLElement, x: number, y: number) => {
    const ed = el.matches('[contenteditable="true"]') ? el : el.querySelector<HTMLElement>('[contenteditable="true"], [data-ed]');
    if (!ed) return false;
    const b = ed.getBoundingClientRect();
    const cx = Math.min(Math.max(x, b.left + 2), b.right - 2), cy = Math.min(Math.max(y, b.top + 2), b.bottom - 2);
    let r: Range | null = (document as any).caretRangeFromPoint?.(cx, cy) || null;
    if (!r) { const p = (document as any).caretPositionFromPoint?.(cx, cy); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
    if (!r || !ed.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); }
    ed.focus(); sel()!.removeAllRanges(); sel()!.addRange(r);
    return true;
  };
  document.addEventListener('click', (e) => {
    if (!on) return;
    const t = e.target as HTMLElement;
    if (!(t === document.body || t === html || mainEl.contains(t))) return;
    if (t.closest('[contenteditable="true"], a, button, input, select, textarea, summary, iframe, video, .sim, .blk-tools, .editbar, .edit-head')) return;
    const kids = [...article.children].filter((c) => (c as HTMLElement).offsetParent && (c as HTMLElement).dataset.deleted === undefined && !c.matches('.crumbs, .meta-line')) as HTMLElement[];
    if (!kids.length) return;
    const y = e.clientY, x = e.clientX;
    const last = kids[kids.length - 1];
    if (y > last.getBoundingClientRect().bottom) {
      if (last.tagName === 'P' && last.dataset.new !== undefined && !(last.textContent || '').trim()) { caretAt(last, x, y); return; }
      insertAfterReady(last, 'p', {}, undefined, true);
      return;
    }
    let best = kids[0], d = Infinity;
    for (const k of kids) { const r = k.getBoundingClientRect(); const dd = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (dd < d) { d = dd; best = k; } }
    caretAt(best, x, y);
  });
  window.addEventListener('scroll', () => { if (on && current && !tools.hidden) place(current); }, { passive: true });
  tools.addEventListener('pointerdown', (e) => e.preventDefault());
  tools.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act || !current) return;
    if (act === 'add') { panelMode = ''; togglePanel('add'); }
    if (act === 'del') removeBlock(current);
    if (act === 'up' || act === 'down') move(current, act === 'up' ? -1 : 1);
  });
  function removeBlock(el: HTMLElement, silent = false) {
    const wasNew = el.dataset.new !== undefined;
    const prev = el.previousElementSibling, parent = el.parentElement!;
    if (wasNew) el.remove(); else { el.dataset.deleted = ''; dirty.delete(el); }
    pushStep(() => { if (wasNew) (prev ? prev.after(el) : parent.prepend(el)); else delete el.dataset.deleted; refresh(); },
      () => { if (wasNew) el.remove(); else el.dataset.deleted = ''; refresh(); });
    tools.hidden = true; current = null;
    refresh();
    if (!silent) say('Deleted. Undo brings it back.');
  }
  // Moving = delete here, add a copy there (text blocks stay editable; components move as they are).
  async function move(el: HTMLElement, dir: number) {
    let sib = (dir < 0 ? el.previousElementSibling : el.nextElementSibling) as HTMLElement | null;
    while (sib && sib.dataset.deleted !== undefined) sib = (dir < 0 ? sib.previousElementSibling : sib.nextElementSibling) as HTMLElement | null;
    if (!sib || !(sib.dataset.src || sib.dataset.new !== undefined)) { say('Can’t move further'); return; }
    if (dir < 0 && !(sib.previousElementSibling as HTMLElement | null)?.matches('[data-src], [data-new]')) { say('That’s the top of this section'); return; }
    let piece = el;
    const wasNew = el.dataset.new !== undefined;
    const home = el.previousElementSibling;
    if (!wasNew) {
      const [s, e] = el.dataset.src!.split('-').map(Number);
      const md = dirty.has(el) ? toMdx(el) : el.dataset.mdNow ?? (await builtFrom()).slice(s, e);
      piece = el.cloneNode(true) as HTMLElement;
      piece.removeAttribute('data-src'); piece.removeAttribute('data-md-now');
      piece.dataset.new = '';
      if (el.dataset.comp || el.dataset.kind || el.dataset.jsx !== undefined) { piece.dataset.kind = 'raw'; piece.dataset.raw = md; piece.querySelectorAll('[contenteditable]').forEach((x) => x.setAttribute('contenteditable', 'false')); piece.contentEditable = 'false'; }
      el.dataset.deleted = ''; dirty.delete(el);
    }
    if (dir < 0) sib.before(piece); else sib.after(piece);
    pushStep(
      () => { if (wasNew) home ? home.after(el) : null; else { piece.remove(); delete el.dataset.deleted; } refresh(); },
      () => { if (!wasNew) el.dataset.deleted = ''; if (dir < 0) sib!.before(piece); else sib!.after(piece); refresh(); },
    );
    refresh(); place(piece);
    piece.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- saving ---------- */
  let buildSrc: Promise<string> | null = null;
  const builtFrom = () => (buildSrc ??= fetch(new URL(`source/${slug}.txt`, base)).then((r) => (r.ok ? r.text() : readLocal(file).then((t) => t || ''))));
  const yamlStr = (t: string) => JSON.stringify(t.replace(/\s+/g, ' ').trim());
  // The new blocks sitting right after an existing block, in order.
  const runAfter = (el: HTMLElement) => {
    const out: HTMLElement[] = [];
    for (let n = el.nextElementSibling as HTMLElement | null; n && (n.dataset.new !== undefined || n.dataset.deleted !== undefined && n.dataset.src === undefined); n = n.nextElementSibling as HTMLElement | null) if (n.dataset.new !== undefined) out.push(n);
    return out;
  };
  const stale = 'This page was changed in Edit page source, so this edit can’t be placed automatically. Make it in Edit page source too.';

  // Was this page changed in Edit page source? Then the blocks on screen may be behind the file, and a
  // rebuild from them would undo those changes.
  const SRC_KEY = `cfi.srcEdited.${slug}`;
  const srcEdited = () => { try { return !!localStorage.getItem(SRC_KEY); } catch { return false; } };
  const isOrig = (n: Element | null): n is HTMLElement => !!n && /^\d+-\d+$/.test((n as HTMLElement).dataset.src || '');
  // The current markdown of a block: as typed if changed, else as last saved, else as built.
  const mdNowOf = (el: HTMLElement, built: string) => {
    if (dirty.has(el) || el.dataset.new !== undefined) return toMdx(el);
    if (el.dataset.mdNow !== undefined) return el.dataset.mdNow;
    const [s, e] = el.dataset.src!.split('-').map(Number); return built.slice(s, e);
  };
  // The whole file again: the built version with every block on screen put back in, in order.
  function rebuild(built: string) {
    type Op = { el: HTMLElement; key: number; s: number; e: number; orig: string; md: string; ins: boolean; run?: HTMLElement[] };
    const ops: Op[] = [];
    // Make sure the page on screen came from this same built version (a fresh deploy moves every offset):
    // the start of each untouched paragraph's words must be where its offsets say.
    const letters = (t: string) => t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    let checked = 0, off = 0;
    for (const el of article.querySelectorAll<HTMLElement>('p[data-src], li[data-src], h2[data-src], h3[data-src]')) {
      if (!isOrig(el) || dirty.has(el) || el.dataset.mdNow !== undefined || el.dataset.deleted !== undefined) continue;
      const w = letters(el.textContent || '').slice(0, 24);
      if (w.length < 8) continue;
      const [s, e] = el.dataset.src!.split('-').map(Number);
      checked++; if (!letters(built.slice(s, e)).includes(w)) off++;
      if (checked >= 12) break;
    }
    if (checked && off / checked > 0.25) throw new Error('The site just updated. Reload the page, then make this change again.');
    for (const el of article.querySelectorAll<HTMLElement>('[data-src]')) {
      if (!isOrig(el)) continue;
      // Inside a block that's being replaced as a whole: that block's markdown already has it.
      const up = el.parentElement?.closest<HTMLElement>('[data-src]');
      if (up && isOrig(up) && (up.dataset.deleted !== undefined || dirty.has(up) || up.dataset.mdNow !== undefined)) continue;
      const [s, e] = el.dataset.src!.split('-').map(Number);
      const orig = built.slice(s, e);
      if (el.dataset.deleted !== undefined) ops.push({ el, key: s, s, e, orig, md: '', ins: false });
      else if (dirty.has(el) || el.dataset.mdNow !== undefined) ops.push({ el, key: s, s, e, orig, md: mdNowOf(el, built), ins: false });
      const run: HTMLElement[] = [];
      for (let n = el.nextElementSibling as HTMLElement | null; n && !isOrig(n); n = n.nextElementSibling as HTMLElement | null) {
        if (n.dataset.deleted === undefined && (n.dataset.new !== undefined || n.dataset.src === 'x') && !(n.tagName === 'P' && !(n.textContent || '').trim())) run.push(n);
      }
      if (run.length) ops.push({ el, key: e + 0.5, s, e, orig, md: run.map((n) => mdNowOf(n, built)).filter(Boolean).join('\n\n'), ins: true, run });
    }
    ops.sort((a, b) => b.key - a.key);
    let text = built;
    for (const op of ops) text = op.ins ? text.slice(0, op.e) + '\n\n' + op.md + text.slice(op.e) : text.slice(0, op.s) + op.md + text.slice(op.e);
    return { text, ops };
  }

  async function save() {
    if (!pending()) return;
    say('Saving…', 'busy'); saveBtn.disabled = true;
    const was = new Map([...dirty].map((el) => [el, edits.get(el) || 0]));
    const gone = [...article.querySelectorAll<HTMLElement>('[data-deleted]')];
    const mdOf = new Map<HTMLElement, string>();
    try {
      const done = await (async () => {
        const [built, curText] = await Promise.all([builtFrom(), readLocal(file)]);
        if (curText == null) throw new Error('Couldn’t find this page’s file. Check your connection and try again.');
        const cur = { text: curText };
        const extra: { path: string; content: string | { base64: string } | null }[] = [];
        // Pictures and files from the device go into public/uploads/ in the same commit.
        for (const el of article.querySelectorAll<HTMLElement>('[data-new][data-upload]')) {
          const name = `uploads/${kebab(slug)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${el.dataset.ext || 'bin'}`;
          extra.push({ path: `public/${name}`, content: { base64: el.dataset.upload!.split(',')[1] } });
          el.dataset.url = basePath + name;
        }
        // Quick way: patch only the blocks that changed into the file as it is on this device.
        // If a block can't be found there any more (the same text twice, or saved in a different shape),
        // rebuild the whole file from the version the page was built from plus everything on screen.
        // Either way the edit is saved; nothing waits for the site to update.
        type Op = { el: HTMLElement; key: number; s: number; e: number; orig: string; md: string; ins: boolean; run?: HTMLElement[] };
        let text = cur.text, ops: Op[] = [], rebuilt = false;
        try { ({ text, ops } = patch()); }
        catch (e: any) {
          if (e.message !== stale || srcEdited()) throw e;
          ({ text, ops } = rebuild(built)); rebuilt = true;
        }
        function patch() {
          let text = cur.text;
          const same = cur.text === built;
          const ops: Op[] = [];
          for (const el of article.querySelectorAll<HTMLElement>('[data-src]')) {
            if (el.parentElement?.closest('[data-deleted]')) continue; // inside something being deleted
            const [s, e] = el.dataset.src!.split('-').map(Number);
            const orig = el.dataset.mdNow ?? built.slice(s, e);
            const b = { el, s, e, orig };
            if (el.dataset.deleted !== undefined) ops.push({ ...b, key: s, md: '', ins: false });
            else if (was.has(el)) ops.push({ ...b, key: s, md: toMdx(el), ins: false });
            const run = runAfter(el);
            if (run.length) { run.forEach((n) => mdOf.set(n, toMdx(n))); ops.push({ ...b, key: e + 0.5, md: run.map((n) => mdOf.get(n)!).filter(Boolean).join('\n\n'), ins: true, run }); }
          }
          for (const op of ops) if (!(same && op.el.dataset.mdNow === undefined)) {
            const at = cur.text.indexOf(op.orig);
            op.key = at < 0 ? -1 : op.ins ? at + op.orig.length + 0.5 : at;
          }
          // Apply from the end of the file backwards so earlier offsets stay right.
          ops.sort((a, b) => b.key - a.key);
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
          return { text, ops };
        }
        // New blocks above the first saved block (e.g. on a brand-new, empty page) go right after the
        // frontmatter and imports.
        const lead: HTMLElement[] = [];
        for (const c of article.children as unknown as HTMLElement[]) {
          if (c.matches('[data-src]') && !(rebuilt && c.dataset.src === 'x')) break;
          if ((c.dataset.new !== undefined || c.dataset.src === 'x') && c.dataset.deleted === undefined && !(c.tagName === 'P' && !(c.textContent || '').trim())) lead.push(c);
        }
        lead.forEach((n) => mdOf.set(n, toMdx(n)));
        const leadMd = lead.map((n) => mdOf.get(n)!).filter(Boolean).join('\n\n');
        if (leadMd) {
          const head = text.match(/^---\n[\s\S]*?\n---\n(?:[ \t]*import [^\n]*\n|[ \t]*\n)*/);
          const at = head ? head[0].length : 0;
          text = text.slice(0, at).replace(/\n*$/, '\n\n') + leadMd + '\n\n' + text.slice(at).replace(/^\n+/, '');
        }
        let newTitle = '';
        for (const el of was.keys()) {
          if (!el.dataset.fm) continue;
          const key = el.dataset.fm;
          const re = new RegExp(`^${key}:.*$`, 'm');
          if (!re.test(text)) throw new Error(`Couldn’t find the ${key} line`);
          text = text.replace(re, `${key}: ${yamlStr(el.textContent || '')}`);
          if (key === 'title') newTitle = (el.textContent || '').replace(/\s+/g, ' ').trim();
        }
        text = text.replace(/\n{3,}/g, '\n\n');
        if (text !== cur.text) extra.push({ path: file, content: text });
        // A renamed page gets its new name in the folders list too.
        if (newTitle) {
          const o = await readLocal('src/data/outline.json');
          if (o) {
            const data = JSON.parse(o);
            for (const t of pagesIn(data.areas)) if (t.slug === slug) t.title = newTitle;
            extra.push({ path: 'src/data/outline.json', content: JSON.stringify(data, null, 2) + '\n' });
          }
        }
        if (!extra.length) return { ops, lead, none: true };
        const title = document.querySelector('h1')?.textContent?.trim() || slug;
        await stage(extra, `Edit “${title}”`);
        return { ops, lead, none: false };
      })();
      // The page now matches GitHub: remember each block's new text so later saves can find it.
      // Remember each block's saved text so later saves can find it. Anything typed while this save ran
      // stays marked and goes in the next one.
      const settle = (n: HTMLElement) => {
        n.dataset.mdNow = mdOf.get(n) ?? toMdx(n); n.dataset.src = 'x'; delete n.dataset.new; delete n.dataset.upload;
        if (toMdx(n) !== n.dataset.mdNow) dirty.add(n);
      };
      done.lead.forEach(settle);
      for (const op of done.ops) {
        if (op.ins) op.run!.forEach(settle);
        else if (op.md) op.el.dataset.mdNow = op.md;
      }
      gone.forEach((x) => x.remove());
      for (const [el, n] of was) if ((edits.get(el) || 0) === n) dirty.delete(el);
      undoStack.length = redoStack.length = 0;
      if (!done.none) await savePage(slug, snapshot());
      refresh();
      say(done.none ? '' : 'Saved', 'ok');
    } catch (err: any) {
      say(err.message || 'Couldn’t save', 'err');
      refresh();
    }
  }

  /* ---------- delete the whole page ---------- */
  let armedDelete = false;
  async function deletePage() {
    const btn = moreMenu.querySelector<HTMLElement>('[data-cmd="delpage"] span')!;
    if (!armedDelete) { armedDelete = true; btn.textContent = 'Tap again to delete for good'; moreMenu.hidden = false; setTimeout(() => { armedDelete = false; btn.textContent = 'Delete this page'; }, 4000); return; }
    moreMenu.hidden = true; say('Deleting…');
    try {
      const o = await readLocal('src/data/outline.json');
      const local = outboxIndex().news.some((n) => n.slug === slug); // made on this device, never uploaded
      const files: { path: string; content: string | null }[] = local ? [] : [{ path: file, content: null }];
      if (o) {
        const data = JSON.parse(o);
        const drop = (f: Folder) => { f.topics = f.topics.filter((t) => isFolder(t) || t.slug !== slug); f.topics.forEach((t) => isFolder(t) && drop(t)); };
        data.areas.forEach(drop);
        files.push({ path: 'src/data/outline.json', content: JSON.stringify(data, null, 2) + '\n' });
      }
      if (local) await dropPage(slug, file);
      await stage(files, local ? '' : `Delete “${document.querySelector('h1')?.textContent?.trim()}”`);
      try { localStorage.setItem('cfi.recent', JSON.stringify(JSON.parse(localStorage.getItem('cfi.recent') || '[]').filter((r: any) => r.slug !== slug))); localStorage.setItem('cfi.notice', 'Page deleted on this device. Tap Upload to remove it from the site.'); } catch {}
      dirty.clear(); location.href = base;
    } catch (err: any) { say(err.message, 'err'); }
  }

  /* ---------- full source editor ---------- */
  const srcText = srcDlg.querySelector<HTMLTextAreaElement>('[data-src-text]')!;
  const srcNote = srcDlg.querySelector<HTMLElement>('[data-src-note]')!;
  async function openSource() {
    const at = selEl()?.closest<HTMLElement>('[data-src]') || current;
    const want = at?.dataset.src && at.dataset.src !== 'x' ? (at.dataset.mdNow ?? (await builtFrom()).slice(...(at.dataset.src.split('-').map(Number) as [number, number]))) : at?.dataset.mdNow || '';
    srcDlg.showModal();
    srcNote.textContent = 'Loading…';
    try {
      srcText.value = (await readLocal(file)) ?? (await builtFrom());
      srcNote.textContent = 'Includes changes saved on this device';
    } catch {
      srcText.value = await builtFrom();
      srcNote.textContent = 'Version this page was built from';
    }
    const i = want ? srcText.value.indexOf(want) : -1;
    if (i >= 0) {
      srcText.focus(); srcText.setSelectionRange(i, i);
      const lh = parseFloat(getComputedStyle(srcText).lineHeight) || 20;
      const cols = Math.max(20, Math.floor(srcText.clientWidth / 7.8));
      const lines = srcText.value.slice(0, i).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cols)), 0);
      srcText.scrollTop = Math.max(0, (lines - 3) * lh);
    }
  }
  srcDlg.querySelector('[data-src-save]')!.addEventListener('click', async () => {
    const go = async () => {
      srcNote.textContent = 'Saving…';
      try {
        await stage([{ path: file, content: srcText.value }], `Edit “${document.querySelector('h1')?.textContent?.trim() || slug}” source`);
        try { localStorage.setItem(SRC_KEY, '1'); } catch {}
        srcNote.textContent = 'Saved on this device. Tap Upload on the home page to put it on the site; the page shows it after that.';
      } catch (err: any) { srcNote.textContent = err.message; }
    };
    go();
  });
  srcDlg.querySelector('[data-close]')!.addEventListener('click', () => srcDlg.close());

  // Keep the bar (and the sheet) sitting on top of the on-screen keyboard.
  const vv = window.visualViewport;
  if (vv) {
    // iOS doesn't shrink the page for the keyboard: fixed bars stay put behind it. So pin the top bar to
    // the top of what you can see and the editor bar to its bottom, measured from the visual viewport.
    let raf = 0;
    const fit = () => {
      raf = 0;
      const layoutH = document.documentElement.clientHeight;
      const up = on && vv.height < layoutH - 80;
      html.classList.toggle('kb-up', up);
      html.style.setProperty('--kb', '0px');
      if (!up) { bar.style.top = bar.style.bottom = head.style.top = pop.style.top = pop.style.bottom = ''; return; }
      const barTop = vv.offsetTop + vv.height - bar.offsetHeight;
      bar.style.bottom = 'auto'; bar.style.top = `${barTop}px`;
      head.style.top = `${vv.offsetTop}px`;
      pop.style.bottom = 'auto'; pop.style.top = `${barTop - (pop.offsetHeight || 52) - 8}px`;
      showCaret(barTop - 10, vv.offsetTop + head.offsetHeight + 8);
    };
    // Keep the line you're typing on in view: between the top bar and the bar on the keyboard.
    const showCaret = (bottom: number, top: number) => {
      const s = sel();
      if (!s?.rangeCount || !article.contains(s.anchorNode)) return;
      const r = s.getRangeAt(0);
      let rect = r.getClientRects()[0] || r.getBoundingClientRect();
      if (!rect || (!rect.height && !rect.top)) { const el = selEl(); if (!el) return; rect = el.getBoundingClientRect(); }
      if (rect.bottom > bottom) window.scrollBy(0, rect.bottom - bottom);
      else if (rect.top < top) window.scrollBy(0, rect.top - top);
    };

    const ask = () => { if (!raf) raf = requestAnimationFrame(fit); };
    document.addEventListener('selectionchange', () => { if (on && html.classList.contains('kb-up')) ask(); });
    article.addEventListener('input', () => { if (html.classList.contains('kb-up')) ask(); });
    vv.addEventListener('resize', ask); vv.addEventListener('scroll', ask);
    addEventListener('scroll', ask, { passive: true });
    document.addEventListener('focusin', () => { ask(); setTimeout(ask, 350); });
    document.addEventListener('focusout', () => setTimeout(ask, 350));
  }
  // Leaving or switching apps saves straight away.
  const now = () => { if (on && (pending() || saving)) autoSave(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') now(); });
  window.addEventListener('pagehide', now);
  window.addEventListener('beforeunload', (e) => { if (pending()) { now(); e.preventDefault(); } });
}
