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

  const blocks = () => [...article.querySelectorAll<HTMLElement>('[data-src], [data-fm]')];
  const say = (t: string, kind = '') => { status.textContent = t; status.dataset.kind = kind; };
  const token = () => { try { return localStorage.getItem(TOKEN) || ''; } catch { return ''; } };
  const refresh = () => {
    saveBtn.disabled = !dirty.size;
    saveBtn.textContent = dirty.size ? `Save ${dirty.size}` : 'Save';
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
    if (on) say(dirty.size ? '' : 'Tap any text to change it');
    else { pop.hidden = true; say(''); }
  }
  document.querySelectorAll<HTMLElement>('[data-edit-toggle]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
    setEditing(!on);
  }));
  article.addEventListener('input', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-src], [data-fm]');
    if (el) { dirty.add(el); refresh(); say(''); }
  });
  // Enter inside a heading or the title would split it: don't.
  article.addEventListener('keydown', (e) => {
    if (!on || e.key !== 'Enter') return;
    if ((e.target as HTMLElement).closest('h1, h2, h3, h4, [data-fm]')) e.preventDefault();
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
    if (cmd === 'save') save();
    if (cmd === 'done') {
      if (dirty.size && !armedDiscard) { armedDiscard = true; doneBtn.textContent = 'Discard?'; say(`${dirty.size} unsaved`); return; }
      if (dirty.size) { dirty.clear(); location.reload(); return; }
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
  function toMdx(el: HTMLElement): string {
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

  async function save() {
    if (!dirty.size) return;
    if (!token()) return needKey(save);
    say('Saving…');
    saveBtn.disabled = true;
    try {
      const [built, cur] = await Promise.all([builtFrom(), latest()]);
      let text = cur.text;
      const same = cur.text === built;
      // Apply from the end of the file backwards so earlier offsets stay right.
      const items = [...dirty].map((el) => {
        if (el.dataset.fm) return { el, s: -1, e: -1, orig: '', md: '' };
        const [s, e] = el.dataset.src!.split('-').map(Number);
        return { el, s, e, orig: el.dataset.mdNow ?? built.slice(s, e), md: toMdx(el) };
      }).sort((a, b) => b.s - a.s);
      for (const it of items) {
        if (it.el.dataset.fm) {
          const key = it.el.dataset.fm;
          const re = new RegExp(`^${key}:.*$`, 'm');
          if (!re.test(text)) throw new Error(`Couldn’t find the ${key} line`);
          text = text.replace(re, `${key}: ${yamlStr(it.el.textContent || '')}`);
          continue;
        }
        if (same && it.el.dataset.mdNow === undefined) { text = text.slice(0, it.s) + it.md + text.slice(it.e); continue; }
        const at = text.indexOf(it.orig);
        if (at < 0 || text.indexOf(it.orig, at + 1) >= 0) throw new Error('The site is still updating from your last save. Try again in a minute, or use the source editor.');
        text = text.slice(0, at) + it.md + text.slice(at + it.orig.length);
      }
      if (text === cur.text) { dirty.clear(); refresh(); say('No changes'); return; }
      const title = document.querySelector('h1')?.textContent?.trim() || slug;
      await commit(text, cur.sha, `Edit “${title}” in the binder`);
      for (const it of items) if (!it.el.dataset.fm) it.el.dataset.mdNow = it.md;
      dirty.clear(); refresh();
      say('Saved. Live in about 2 min', 'ok');
    } catch (err: any) {
      if (err.key) { try { localStorage.removeItem(TOKEN); } catch {} say(''); refresh(); return needKey(save); }
      say(err.message || 'Couldn’t save', 'err');
      refresh();
    }
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
