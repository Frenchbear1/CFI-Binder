import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import remarkSourcePos from './src/lib/remark-source-pos.mjs';

// SITE / BASE let the same build run on Vercel (base "/") or GitHub Pages ("/repo-name/").
export default defineConfig({
  site: process.env.SITE || 'https://example.com',
  base: process.env.BASE || '/',
  trailingSlash: 'ignore',
  integrations: [mdx({ remarkPlugins: [remarkSourcePos] })],
  build: { format: 'directory', assets: 'assets' },
});
