// Vercel Routing Middleware: the binder's lessons are only for the signed-in instructor.
// Signed out (a student opening the link), you get the Interactives and what they need, nothing else:
// "/" shows the Interactives list, lesson pages go to the sign-in page, and search, sources and lesson
// pictures are refused.
import { next, rewrite } from '@vercel/functions';
import { validToken, readCookie, COOKIE } from './lib/auth.js';

// Open to everyone: the sims and their pages, the sign-in page, the site's code/styles/icons, and the
// reference library (FAA handbooks and regulations the sims cite).
const OPEN = /^\/(interactives(\/|$)|login(\/|$)|api\/login|assets\/|library\/|vendor\/|favicon|icon-|manifest\.webmanifest|sw\.js|robots\.txt)/;

export default async function middleware(req) {
  const url = new URL(req.url);
  if (await validToken(readCookie(req, COOKIE), process.env.CFI_SECRET)) return next();
  if (OPEN.test(url.pathname)) return next();
  if (url.pathname === '/' || url.pathname === '/index.html') return rewrite(new URL('/interactives/', url));
  const page = !/\.[a-z0-9]+$/i.test(url.pathname) || url.pathname.endsWith('.html');
  if (page) return Response.redirect(new URL(`/login/?next=${encodeURIComponent(url.pathname + url.search)}`, url), 307);
  return new Response('Sign in to see this.', { status: 401, headers: { 'cache-control': 'no-store' } });
}
