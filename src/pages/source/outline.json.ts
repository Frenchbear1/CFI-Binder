// The folder list as committed, so the app can add pages and folders on the device before uploading.
import { readFileSync } from 'node:fs';
export const GET = () => new Response(readFileSync('src/data/outline.json', 'utf8'), { headers: { 'content-type': 'application/json; charset=utf-8' } });
