import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// SITE / BASE let the same build run on Vercel (base "/") or GitHub Pages ("/repo-name/").
export default defineConfig({
  site: process.env.SITE || 'https://example.com',
  base: process.env.BASE || '/',
  trailingSlash: 'ignore',
  integrations: [mdx()],
  build: { format: 'directory', assets: 'assets' },
});
