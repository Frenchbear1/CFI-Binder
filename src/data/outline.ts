// The binder's table of contents lives in outline.json so the in-app editor can add pages and folders.
// A topic with `slug` is written; others are planned. levels: pa = Private, ir = Instrument, ca = Commercial.
import data from './outline.json';
export type Level = 'pa' | 'ir' | 'ca';
export interface Topic { title: string; slug?: string; levels: Level[]; icon?: string }
export interface Area { title: string; topics: Topic[]; icon?: string }
export const outline = data.areas as Area[];
