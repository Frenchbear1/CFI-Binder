// Cloud sync on every signed-in page (only once the binder has a Firebase project, see cloud.ts):
// - you need your Google sign-in on this device too (the binder's cookie alone isn't enough to sync)
// - the very first time, the site's lessons are copied into Firestore, and anything still waiting for the
//   old Upload button on this device is carried over
// - a lesson shows its newest saved copy and updates by itself when you change it on another device
// - the side menu and Contents follow the folder list as it is now
import { cloudOn, currentUser, ready, watch, lessonPath, showUploads, hrefOf } from './cloud';
import { migrateLegacy } from './outbox';
import { isFolder, pagesIn, type Folder, type Node } from '../data/tree';

const html = document.documentElement;
const body = document.body;
const base = body.dataset.base || '/';
const guest = body.classList.contains('guest');
const article = document.querySelector<HTMLElement>('[data-article]');
const EDITED = 'cfi.cloudEdited';
const edited = (): string[] => { try { return JSON.parse(localStorage.getItem(EDITED) || '[]'); } catch { return []; } };
const markEdited = (slug: string, v: boolean) => {
  const s = new Set(edited()); if (v) s.add(slug); else s.delete(slug);
  try { localStorage.setItem(EDITED, JSON.stringify([...s])); } catch {}
};
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Instant: show this device's last copy of the page straight away (no waiting for Firebase to load);
// Firestore then brings it up to date in the background if it changed somewhere else.
const PAGE = (slug: string) => `cfi.page.${slug}`;
const staticHtml = article?.innerHTML ?? '';
let cachedHtml = '';
if (cloudOn && !guest && article?.dataset.slug) {
  try { cachedHtml = localStorage.getItem(PAGE(article.dataset.slug)) || ''; } catch {}
  if (cachedHtml && cachedHtml !== article.innerHTML) { article.innerHTML = cachedHtml; document.dispatchEvent(new CustomEvent('cfi:article')); }
  if (cachedHtml) html.classList.remove('local-wait');
}
function remember(slug: string, h: string) {
  try { localStorage.setItem(PAGE(slug), h); }
  catch {
    // Full: forget the other pages' copies (they come back from Firestore's own copy next time).
    try { Object.keys(localStorage).filter((k) => k.startsWith('cfi.page.') && k !== PAGE(slug)).forEach((k) => localStorage.removeItem(k)); localStorage.setItem(PAGE(slug), h); } catch {}
  }
}

if (cloudOn && !guest) (async () => {
  const user = await currentUser().catch(() => null);
  if (!user) {
    html.classList.remove('local-wait');
    location.replace(`${base}login/?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  // Already set up on this device: don't wait on the network before showing anything.
  const known = (() => { try { return localStorage.getItem('cfi.seeded') === '1'; } catch { return false; } })();
  if (known) { if (article) showLesson(article); }
  if (!(await ready())) return;
  try { localStorage.setItem('cfi.seeded', '1'); } catch {}
  if (!known && article) showLesson(article);
  migrateLegacy().then((n) => { if (n) { try { localStorage.setItem('cfi.notice', `Moved ${n} change${n === 1 ? ' that was' : 's that were'} waiting on this device into your synced binder.`); } catch {} } }).catch((e) => console.warn('migrate', e));
  watch('binder/outline', (d) => { if (d?.json) navFrom(JSON.parse(d.json).areas); });
})();

function showLesson(article: HTMLElement) {
  const slug = article.dataset.slug || '';
  if (!slug) { html.classList.remove('local-wait'); return; }
  const isDraft = !!document.querySelector('[data-draft]');
  const built = isDraft ? '' : staticHtml;
  let shown = cachedHtml, first = true;
  const stop = setTimeout(() => html.classList.remove('local-wait'), 4000);
  watch(lessonPath(slug), (d, m) => {
    const was = first; first = false;
    if (!d) {
      // Not in the binder (deleted, or a link to a page that never existed).
      if (!m.cache && (isDraft || was)) {
        html.classList.remove('local-wait');
        if (isDraft) { article.querySelector('h1')!.textContent = 'This page isn’t in your binder'; article.querySelector('.meta-line')!.textContent = ''; }
      }
      if (!m.cache) { markEdited(slug, false); try { localStorage.removeItem(PAGE(slug)); } catch {} }
      return;
    }
    if (!d.html) { html.classList.remove('local-wait'); return; }
    // Our own save coming back: the page already shows it.
    if (!was && m.local) { shown = d.html; remember(slug, d.html); return; }
    // Editing right now: don't pull the page out from under you (your next save wins).
    if (html.classList.contains('editing')) { shown = d.html; remember(slug, d.html); return; }
    if (d.html !== shown && !(was && d.html === built && !cachedHtml)) {
      article.innerHTML = d.html;
      document.dispatchEvent(new CustomEvent('cfi:article'));
    }
    shown = d.html;
    remember(slug, d.html);
    showUploads(article);
    if (!isDraft) markEdited(slug, d.html !== built);
    if (d.title) {
      document.title = `${d.title} · Aviation Binder`;
      const cur = document.querySelector('[data-current]'); if (cur) cur.textContent = d.title;
    }
    clearTimeout(stop);
    html.classList.remove('local-wait');
    // A page you just made opens ready to type in, like Notion.
    if (was && /[?&]new=1/.test(location.search)) {
      history.replaceState(null, '', location.pathname + location.search.replace(/[?&]new=1/, '').replace(/^&/, '?'));
      const t = [...document.querySelectorAll<HTMLElement>('[data-edit-toggle]')].find((b) => b.offsetParent);
      t?.click();
    }
  });
}

/* ---------- the side menu and Contents, from the folder list as it is now ---------- */
const lv = (n: Node) => (isFolder(n) ? [...new Set(pagesIn(n.topics).flatMap((p) => p.levels))] : n.levels).join(' ') || 'pa ir ca';
function list(nodes: Node[], here: string): string {
  return `<ul>${nodes.map((n) => isFolder(n)
    ? `<li class="nav-sub" data-for="${lv(n)}"><p class="nav-sub-t">${esc(n.title)}</p>${list(n.topics, here)}</li>`
    : `<li data-for="${lv(n)}">${n.slug ? `<a href="${hrefOf(n.slug)}"${n.slug === here ? ' aria-current="page"' : ''}>${esc(n.title)}</a>` : `<span class="planned" title="Coming soon">${esc(n.title)}</span>`}</li>`).join('')}</ul>`;
}
let lastNav = '';
function navFrom(areas: Folder[]) {
  const key = JSON.stringify(areas);
  if (key === lastNav) return; lastNav = key;
  const here = article?.dataset.slug || '';
  const side = document.querySelector<HTMLElement>('.sidenav');
  if (side) side.innerHTML = areas.map((a) => `<div class="nav-area"><p class="nav-area-title">${esc(a.title)}</p>${list(a.topics, here)}</div>`).join('');
  const sheet = document.querySelector<HTMLElement>('.sheet-nav');
  if (sheet) sheet.innerHTML = areas.map((a) => `<details${pagesIn(a.topics).some((t) => t.slug === here) ? ' open' : ''}><summary>${esc(a.title)}</summary>${list(a.topics, here)}</details>`).join('');
  const data = document.getElementById('outline-data'); if (data) data.textContent = JSON.stringify(areas);
}
