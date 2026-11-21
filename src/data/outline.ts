// The binder's table of contents lives in outline.json so the in-app editor can add pages and folders.
// Folders can hold pages and more folders (see tree.ts). A page with `slug` is written; others are planned.
// levels: pa = Private, ir = Instrument, ca = Commercial.
import data from './outline.json';
import type { Folder, Page } from './tree';
export type Level = 'pa' | 'ir' | 'ca';
export type Topic = Page;
export type Area = Folder;
export const outline = data.areas as Area[];
