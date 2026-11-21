// Student screen, the instructor's side (phone or laptop, signed in).
// Pair once with the iPad's code, then every picture, video and interactive gets a "Show" button that puts it
// on the iPad as a slide. The Student screen sheet steps through the slides, blanks the screen, or clears it.
const body = document.body;
const base = body.dataset.base || '/';
const API = base + 'api/screen';
const KEY = 'cfi.screen';

type Item = { kind: 'sim' | 'video' | 'html'; title?: string; [k: string]: unknown };
type State = { v: number; paired: boolean; at: number; blank: boolean; deck: Item[] };

const get = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const put = (c: string) => { try { c ? localStorage.setItem(KEY, c) : localStorage.removeItem(KEY); } catch {} };

if (!body.classList.contains('guest')) init();

function init() {
  let code = get();
  let state: State | null = null;
  const sheet = document.getElementById('sheet-screen') as HTMLDialogElement | null;
  const q = <T extends Element = HTMLElement>(s: string) => sheet?.querySelector(s) as T | null;

  async function call(op: string, extra: Record<string, unknown> = {}, c = code) {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, c, ...extra }) });
    const j = await r.json().catch(() => ({ error: 'net' }));
    if (!r.ok || j.error) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status });
    return j;
  }
  async function refresh() {
    if (!code) return;
    try {
      const r = await fetch(`${API}?op=state&c=${code}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.gone) { forget('That screen closed. Open the screen page on the iPad again to get a new code.'); return; }
      if (!j.error) state = j;
    } catch {}
    render();
  }
  function forget(msg = '') { code = ''; state = null; put(''); render(); const m = q('[data-scr-msg]'); if (m) m.textContent = msg; }

  /* ---- the sheet ---- */
  const icon = (it: Item) => it.kind === 'sim' ? '◎' : it.kind === 'video' ? '▶' : '▣';
  function render() {
    document.documentElement.classList.toggle('scr-paired', !!code);
    document.querySelectorAll<HTMLElement>('.screen-btn').forEach((b) => b.classList.toggle('on', !!code));
    document.querySelectorAll<HTMLElement>('[data-scr-row]').forEach((e) => (e.textContent = code ? `Connected · ${code} ›` : 'Connect an iPad ›'));
    if (!sheet) return;
    q('[data-scr-off]')!.hidden = !!code;
    q('[data-scr-on]')!.hidden = !code;
    if (!code) return;
    q('[data-scr-code]')!.textContent = code;
    const deck = state?.deck || [];
    q('[data-scr-hint]')!.hidden = deck.length > 0;
    q('[data-scr-clear]')!.hidden = !deck.length;
    q('[data-scr-blank]')!.classList.toggle('on', !!state?.blank);
    q<HTMLElement>('[data-scr-blank] span')!.textContent = state?.blank ? 'Show' : 'Blank';
    q('[data-scr-deck]')!.innerHTML = deck.map((it, i) => `<li class="${i === state!.at ? 'cur' : ''}"><button type="button" data-scr-at="${i}"><span class="ic">${icon(it)}</span><span class="t"></span></button><button type="button" class="x" data-scr-rm="${i}" aria-label="Remove">×</button></li>`).join('');
    q('[data-scr-deck]')!.querySelectorAll('.t').forEach((t, i) => (t.textContent = deck[i].title || 'Slide ' + (i + 1)));
  }
  if (sheet) {
    q('[data-scr-url]')!.textContent = location.host + base + 'screen';
    sheet.addEventListener('toggle', () => { if (sheet.open) refresh(); });
    new MutationObserver(() => { if (sheet.open) refresh(); }).observe(sheet, { attributes: true, attributeFilter: ['open'] });
    q('[data-scr-form]')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inp = q<HTMLInputElement>('[data-scr-input]')!, msg = q('[data-scr-msg]')!;
      const c = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (c.length < 6) { msg.textContent = 'The code has 6 letters and numbers.'; return; }
      msg.textContent = 'Connecting…';
      try { state = await call('claim', {}, c); code = c; put(c); inp.value = ''; msg.textContent = ''; render(); }
      catch (err: any) { msg.textContent = err.status === 404 ? "That code isn't open on a screen. Check the iPad." : err.status === 401 ? 'Sign in again first.' : "Couldn't reach the screen. Try again."; }
    });
    q('[data-scr-unpair]')!.addEventListener('click', async () => { try { await call('unpair'); } catch {} forget(); });
    q('[data-scr-clear]')!.addEventListener('click', async () => { try { state = await call('clear'); } catch {} render(); });
    q('[data-scr-blank]')!.addEventListener('click', async () => { try { state = await call('blank', { on: !state?.blank }); } catch {} render(); });
    sheet.querySelectorAll<HTMLElement>('[data-scr-go]').forEach((b) => b.addEventListener('click', async () => {
      if (!state?.deck.length) return;
      try { state = await call('go', { at: state.at + Number(b.dataset.scrGo) }); } catch {} render();
    }));
    q('[data-scr-deck]')!.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement, at = t.closest<HTMLElement>('[data-scr-at]'), rm = t.closest<HTMLElement>('[data-scr-rm]');
      try {
        if (at) state = await call('go', { at: Number(at.dataset.scrAt) });
        else if (rm) state = await call('remove', { at: Number(rm.dataset.scrRm) });
      } catch {}
      render();
    });
  }

  /* ---- pairing page (/screen/pair/?c=CODE, opened by scanning the iPad's QR code) ---- */
  const pairBox = document.querySelector<HTMLElement>('[data-pair-page]');
  if (pairBox) {
    const c = (new URLSearchParams(location.search).get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const say = (h: string, p: string) => { pairBox.querySelector('h1')!.textContent = h; pairBox.querySelector('p')!.textContent = p; };
    if (!c) say('No code', 'Scan the code on the iPad again.');
    else call('claim', {}, c).then((s) => { state = s; code = c; put(c); render(); say('Connected', `This device now drives screen ${c}. Open any lesson and tap Show on a picture, video or interactive.`); pairBox.querySelector<HTMLElement>('[data-pair-next]')!.hidden = false; })
      .catch((err) => say("Couldn't connect", err.status === 404 ? 'That code has expired. Reload the screen page on the iPad and scan again.' : 'Check your connection and scan again.'));
  }

  /* ---- "Show" buttons ---- */
  const abs = (u: string) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname + x.search : x.href; } catch { return u; } };
  // A figure's caption without the Show button and the "Full screen" link.
  const capOf = (el: HTMLElement) => {
    const c = el.querySelector(':scope > figcaption')?.cloneNode(true) as HTMLElement | undefined;
    if (!c) return '';
    c.querySelectorAll('.cast-btn, a[href*="/interactives/"]').forEach((x) => x.remove());
    return (c.textContent || '').replace(/\s*·\s*$/, '').replace(/\s+/g, ' ').trim();
  };
  // A short name for the slide list: the video's or sim's title, else the caption's first sentence, else the section heading.
  const titleOf = (el: HTMLElement) => {
    const strong = el.querySelector('figcaption strong, figcaption > span')?.textContent?.trim();
    if (strong) return strong.slice(0, 80);
    const cap = capOf(el).split(/(?<=[.!?])\s/)[0];
    if (cap) return cap.length > 70 ? cap.slice(0, 68) + '…' : cap;
    let h: Element | null = el; while (h && !/^H[1-4]$/.test(h.tagName)) h = h.previousElementSibling || h.parentElement;
    return (h?.textContent || document.title).trim().slice(0, 80);
  };
  function itemFor(el: HTMLElement): Item | null {
    const root = el.querySelector<HTMLElement>('.sim-root');
    if (root) return { kind: 'sim', id: root.dataset.sim, title: titleOf(el) };
    if (el.classList.contains('video')) {
      const b = el.querySelector<HTMLElement>('[data-video]'), v = el.querySelector('video');
      if (b) return { kind: 'video', provider: b.dataset.provider, vid: b.dataset.vid, start: Number(b.dataset.start) || 0, title: titleOf(el) };
      if (v) return { kind: 'video', provider: 'file', src: abs(v.getAttribute('src') || ''), poster: v.poster ? abs(v.poster) : '', title: titleOf(el) };
      return null;
    }
    const art = el.querySelector('.figure-art');
    if (!art) return null;
    const c = art.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.cast-btn, script').forEach((x) => x.remove());
    c.querySelectorAll('img').forEach((i) => { i.setAttribute('src', abs(i.getAttribute('src') || '')); i.removeAttribute('srcset'); i.removeAttribute('loading'); });
    const all = [...document.querySelectorAll('[data-article] .figure')];
    return { kind: 'html', key: `${location.pathname}#${all.indexOf(el)}`, html: c.innerHTML, caption: capOf(el), title: titleOf(el) };
  }
  async function send(el: HTMLElement, btn: HTMLButtonElement) {
    if (!code) { openSheetNamed(); return; }
    const it = itemFor(el);
    if (!it) return;
    btn.classList.add('busy');
    try { state = await call('send', { item: it }); btn.classList.add('sent'); btn.querySelector('span')!.textContent = 'On screen'; setTimeout(() => { btn.classList.remove('sent'); btn.querySelector('span')!.textContent = 'Show'; }, 1600); }
    catch (err: any) {
      btn.querySelector('span')!.textContent = err.message === 'item' ? 'Too big' : err.status === 404 ? 'Screen closed' : 'Try again';
      if (err.status === 404) forget('That screen closed. Open the screen page on the iPad again.');
      setTimeout(() => (btn.querySelector('span')!.textContent = 'Show'), 2200);
    }
    btn.classList.remove('busy');
  }
  const openSheetNamed = () => document.querySelector<HTMLElement>('[data-open="screen"]')?.click();
  function addButtons() {
    document.querySelectorAll<HTMLElement>('[data-article] .figure, [data-article] .video, figure.sim').forEach((el) => {
      if (el.querySelector(':scope > .cast-row, :scope > figcaption > .cast-btn')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cast-btn'; b.title = 'Show on the student screen';
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg><span>Show</span>';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); send(el, b); });
      const cap = el.querySelector(':scope > figcaption');
      if (cap) { cap.append(' ', b); } else { const row = document.createElement('div'); row.className = 'cast-row'; row.append(b); el.append(row); }
    });
  }
  addButtons();
  document.addEventListener('cfi:article', () => addButtons());
  render();
  if (code) refresh();
}
