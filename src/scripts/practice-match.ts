// Practice mode, the forgiving part: turning words into comparable tokens, picking a lesson's key points
// and keywords, and spotting those keywords in a live transcript.
// Pure functions only (no DOM), so they can be tested on their own.

export type Group = { alts: string[]; stems: string[][] };            // one keyword and the other ways to say it
export type Point = { id: string; title: string; sub: boolean; levels: string[] | null; groups: Group[] };
export type Saved = { v: 1; points: { title: string; sub?: boolean; levels?: string[]; keywords: string[][] }[] };

const STOP = new Set(`a about above after again against all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each even every few for from further get gets got had has have
having he her here hers him his how i if in into is it its itself just like lot lots make makes may me more most much must my
no nor not now of off on once one only or other our ours out over own put really same says see she should since so some still
such than that thats the their them then there these they thing things this those though through thus to too two under until
up upon us very via was way we well were what when where whether which while who why will with within without would yes yet
you your youre yours its theyre dont doesnt isnt cant wont lets okay ok right going gonna want kind sort actually basically
let say said tell tells talk talking youll youve youd theyll theyve ill im ive weve hes shes didnt arent wasnt wouldnt shouldnt couldnt`.split(/\s+/));
// Words that run through every lesson. Fine to say, useless as a keyword.
const GENERIC = new Set(`airplane airplanes aircraft plane planes pilot pilots student students instructor cfi our both c172 pa
28 181 cessna piper lesson flight fly flying flies time times need needs use used uses using good part parts show shows first
second third next new big small little high low less teach teaching taught keep keeps note private instrument commercial
means mean matter matters number numbers common error errors work works simply real still almost enough back built hand hands
move moves moving feel feels look looks give gives take takes come comes goes limit limits model models year years plus bag
bags left right toward away whole same different much many most least lot also maybe usually often always never stuff`.split(/\s+/));

const NUM: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70',
  eighty: '80', ninety: '90', hundred: '100' };

// Things said several ways. Any one of a set counts for all of them.
const ALIASES: string[][] = [
  ['CG', 'center of gravity', 'c of g'], ['angle of attack', 'AOA'], ['POH', 'pilots operating handbook', 'operating handbook', 'AFM'],
  ['IMC', 'instrument meteorological conditions', 'in the clouds'], ['VMC', 'visual meteorological conditions'],
  ['IFR', 'instrument flight rules'], ['VFR', 'visual flight rules'], ['ATC', 'air traffic control'],
  ['C172', 'Cessna', 'Skyhawk', '172'], ['PA-28', 'Piper', 'Archer', 'Cherokee', 'PA28'],
  ['anti-servo tab', 'antiservo tab', 'anti servo'], ['weight and balance', 'W and B', 'W&B'],
  ['manifold pressure', 'MP'], ['RPM', 'rpms', 'revolutions per minute'], ['indicated airspeed', 'IAS'], ['true airspeed', 'TAS'],
  ['AGL', 'above ground level'], ['MSL', 'mean sea level', 'sea level'], ['PFD', 'primary flight display'], ['MFD', 'multi function display'],
  ['AHRS', 'attitude heading reference'], ['ADM', 'aeronautical decision making', 'decision making'],
  ['14 CFR', 'FAR', 'FARs', 'regulations', 'regs'], ['AIM', 'aeronautical information manual'], ['PHAK', 'pilots handbook'],
  ['ACS', 'airman certification standards'], ['AD', 'airworthiness directive'], ['Vx', 'best angle'], ['Vy', 'best rate'],
  ['Va', 'maneuvering speed'], ['Vne', 'never exceed'], ['Vfe', 'flap extended speed'], ['Vso', 'stall speed landing configuration'],
  ['CTAF', 'common traffic advisory frequency'], ['ATIS', 'automatic terminal information service'],
  ['NOTAM', 'notice to air missions', 'notice to airmen'], ['TAF', 'terminal aerodrome forecast'], ['METAR', 'weather report'],
  ['TFR', 'temporary flight restriction'], ['flight review', 'BFR', 'biennial flight review'], ['IPC', 'instrument proficiency check'],
  ['ELT', 'emergency locator transmitter'], ['ADS-B', 'ads b'], ['GPS', 'GNSS'], ['VOR', 'omni'], ['DME', 'distance measuring equipment'],
  ['carb heat', 'carburetor heat'], ['carb ice', 'carburetor ice', 'carburetor icing'], ['mixture', 'leaning', 'lean'],
  ['pitot static', 'pitot-static'], ['go-around', 'go around', 'balked landing'], ['crosswind', 'cross wind'],
  ['stall', 'stalls', 'stalling'], ['spin', 'spins'], ['yaw', 'yawing'], ['roll', 'rolling', 'bank'], ['pitch', 'nose up', 'nose down'],
];

/** Lowercase words, with numbers, letters and spellings evened out the way speech engines vary them. */
export function words(s: string): string[] {
  const t = s.toLowerCase().replace(/[’'`]/g, '').replace(/&/g, ' and ')
    .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => { if (run.length > 1) out.push(run.join('')); else out.push(...run); run = []; };
  for (const w0 of t.split(' ')) {
    const w = NUM[w0] ?? w0;
    // "c g" / "v x" / "i f r": spoken or spelled-out letters become one word
    if (w.length === 1 && /[a-z]/.test(w) && w !== 'a') { run.push(w); continue; }
    flush(); out.push(w);
  }
  flush();
  return out;
}

/** A light stemmer: "dihedrals" = "dihedral", "banking" = "bank", "stalled" = "stall". */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  let s = w;
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('ied') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('edly') && s.length > 6) s = s.slice(0, -4);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (/(ss|sh|ch|x|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.endsWith('ly') && s.length > 5) s = s.slice(0, -2);
  if (s.length > 4 && /([b-df-hj-np-tv-z])\1$/.test(s) && !/(ll|ss|zz)$/.test(s)) s = s.slice(0, -1); // "stopp" → "stop"
  if (s.endsWith('e') && s.length > 4) s = s.slice(0, -1);
  return s;
}

const content = (ws: string[]) => ws.filter((w) => !STOP.has(w));
/** The stems of a keyword, with filler words dropped ("center of gravity" → center, gravity). */
export const stems = (phrase: string) => { const ws = words(phrase); const c = content(ws); return (c.length ? c : ws).map(stem); };

function lev(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** Two stems that are close enough: the same, a near miss by the speech engine, or the same word family. */
export function same(a: string, b: string) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 5 || /\d/.test(a + b)) return false;
  // sounds the same ("fugoid" for phugoid, "dyhedral" for dihedral)
  const ka = sound(a), kb = sound(b);
  if (ka === kb) return true;
  // the same word family ("stabilize", "stabilizer"), or a near miss by the speech engine.
  // Same first two letters, so "stable" ≠ "stall" and "stability" ≠ "instability".
  if (a.slice(0, 2) !== b.slice(0, 2) || n < 6) return false;
  if (n >= 8 && a.slice(0, 8) === b.slice(0, 8)) return true;
  const max = n >= 10 ? 2 : 1;
  return lev(a, b, max) <= max;
}
const sound = (w: string) => w.replace(/ph/g, 'f').replace(/ck|q/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/y/g, 'i').replace(/(.)\1+/g, '$1').replace(/^[aeiou]/, 'a');

/** Is this keyword (any of its ways of saying it) somewhere in these spoken stems? All its words, close together, any order. */
export function heard(g: Group, said: string[]) {
  for (const alt of g.stems) {
    if (!alt.length) continue;
    const win = alt.length === 1 ? 1 : alt.length * 2 + 2;
    for (let i = 0; i < said.length; i++) {
      // a word the engine split in two ("die hedral") counts as one
      if (alt.length === 1 && i + 1 < said.length && alt[0].length >= 6 && same(alt[0], said[i] + said[i + 1])) return true;
      if (!alt.some((w) => same(w, said[i]))) continue;
      const span = said.slice(Math.max(0, i - win + 1), i + win);
      if (alt.every((w) => span.some((x) => same(w, x)))) return true;
    }
  }
  return false;
}

/** How many keywords of a point must be heard before it ticks off. */
export const need = (n: number, frac: number) => Math.max(1, Math.min(n, Math.round(n * frac + 0.001)));

/** Build a keyword with its aliases. */
export function group(alts: string[], extra: Map<string, string[]> = new Map()): Group {
  const all: string[] = [];
  const add = (a: string) => { const t = a.trim(); if (t && !all.some((x) => x.toLowerCase() === t.toLowerCase())) all.push(t); };
  alts.forEach(add);
  const key = (a: string) => words(a).join(' ');
  for (const a of [...all]) {
    const k = key(a);
    for (const set of ALIASES) if (set.some((x) => key(x) === k)) set.forEach(add);
    extra.get(k)?.forEach(add);
  }
  return { alts: all, stems: all.map(stems).filter((s) => s.length) };
}

/* ---------- picking key points out of a lesson ---------- */
export type Section = { id: string; title: string; sub: boolean; text: string; bold: string[] };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const pointId = slugify;

/** "center of gravity (CG)" anywhere in the lesson → CG and center of gravity count as the same keyword. */
export function abbreviations(text: string) {
  const m = new Map<string, string[]>();
  for (const x of text.matchAll(/((?:[A-Za-z-]+\s+){1,5}?)\(([A-Z]{2,5})\)/g)) {
    const ab = x[2], ws = x[1].trim().split(/\s+/);
    for (let n = Math.min(5, ws.length); n >= 2; n--) {
      const ph = ws.slice(-n);
      if (STOP.has(ph[0].toLowerCase())) continue;
      const initials = ph.filter((w) => !STOP.has(w.toLowerCase())).map((w) => w[0].toLowerCase()).join('');
      if (initials === ab.toLowerCase()) {
        const p = ph.join(' ');
        const a = words(ab).join(' '), b = words(p).join(' ');
        m.set(a, [...(m.get(a) || []), p]); m.set(b, [...(m.get(b) || []), ab]);
        break;
      }
    }
  }
  return m;
}

/** Key points from a lesson's sections: one per heading, with up to 5 keywords each. */
export function pick(sections: Section[], fullText: string): Omit<Point, 'levels'>[] {
  const abbr = abbreviations(fullText);
  const S = sections.length;
  const bag = sections.map((s) => content(words(s.text)).filter((w) => w.length > 2 && !GENERIC.has(w)));
  const df = new Map<string, number>();
  bag.forEach((ws) => new Set(ws.map(stem)).forEach((st) => df.set(st, (df.get(st) || 0) + 1)));
  const everywhere = (st: string) => S >= 4 && (df.get(st) || 0) / S >= 0.5;
  const idf = (st: string) => Math.log(1 + S / (df.get(st) || 1));

  return sections.map((s, i) => {
    const cand = new Map<string, { raw: string; alts: string[]; score: number; st: string[] }>();
    const offer = (raw0: string, score: number) => {
      // "Keel (pendulum) effect" → keel effect, or pendulum
      const alts: string[] = [];
      const pm = raw0.match(/\(([^),]+)\)/);
      if (pm && pm[1].trim().split(/\s+/).length <= 3) alts.push(pm[1].trim());
      const raw = raw0.replace(/\s*\([^)]*\)/g, '');
      const clean = raw.replace(/\s+/g, ' ').replace(/^(the|a|an)\s+/i, '').replace(/[:.,;!?]+$/, '').trim();
      const ws = words(clean), cw = content(ws).filter((w) => !GENERIC.has(w));
      if (!cw.length || ws.length > (score >= 10 ? 3 : 4) || clean.length < 2) return;
      const st = cw.map(stem);
      if (st.every(everywhere)) return;
      const k = st.join(' ');
      const c = cand.get(k);
      if (c) c.score += score; else cand.set(k, { raw: clean, alts: alts.map((a) => a.replace(/[:.,;!?]+$/, '')), score, st });
    };
    // bold terms are the lesson's own key words; bold labels ("How it works, simply:", "Private:") aren't
    s.bold.forEach((b) => { const t = b.trim(); if (!/,|^(how|what|why|when|where|which|who)\b/i.test(t.replace(/\([^)]*\)/g, ''))) offer(t, 10); });
    content(words(s.title)).filter((w) => !GENERIC.has(w) && w.length > 2).forEach((w) => offer(w, 2.5));
    // terms this section says a lot that the rest of the lesson doesn't
    const ws = bag[i], tf = new Map<string, { n: number; raw: string }>();
    const bump = (k: string, raw: string) => { const e = tf.get(k); if (e) e.n++; else tf.set(k, { n: 1, raw }); };
    ws.forEach((w, j) => {
      if (w.length < 4 || /\d/.test(w)) return;
      bump(stem(w), w);
      const nx = ws[j + 1];
      if (nx && nx.length > 2 && !/\d/.test(nx)) bump(stem(w) + ' ' + stem(nx), w + ' ' + nx);
    });
    for (const [k, e] of tf) {
      const parts = k.split(' ');
      if (e.n < (parts.length > 1 ? 2 : 3) || (parts.length === 1 && k.length < 5)) continue;
      offer(e.raw, e.n * parts.reduce((a, p) => a + idf(p), 0) * (parts.length > 1 ? 0.7 : 0.5));
    }
    const chosen: { raw: string; alts: string[]; st: string[] }[] = [];
    const max = s.sub ? 4 : 5;
    for (const c of [...cand.values()].sort((a, b) => b.score - a.score)) {
      if (chosen.length >= max) break;
      // skip near-repeats: "servo tab" once "anti-servo tab" is in
      const overlaps = chosen.some((x) => { const n = c.st.filter((w) => x.st.includes(w)).length; return n > 0 && n * 2 > Math.min(c.st.length, x.st.length); });
      if (!overlaps) chosen.push(c);
    }
    return { id: s.id, title: s.title, sub: s.sub, groups: chosen.map((c) => group([c.raw, ...c.alts], abbr)) };
  }).filter((p) => p.groups.length);
}

export function toSaved(points: Point[]): Saved {
  return { v: 1, points: points.map((p) => ({ title: p.title, ...(p.sub ? { sub: true } : {}), ...(p.levels ? { levels: p.levels } : {}), keywords: p.groups.map((g) => g.alts) })) };
}
export function fromSaved(s: Saved): Point[] {
  const seen = new Set<string>();
  return s.points.map((p) => {
    let id = pointId(p.title) || 'point';
    while (seen.has(id)) id += '-2';
    seen.add(id);
    return { id, title: p.title, sub: !!p.sub, levels: p.levels?.length ? p.levels : null, groups: p.keywords.map((k) => ({ alts: k, stems: k.map(stems).filter((x) => x.length) })).filter((g) => g.stems.length) };
  });
}

/* ---------- the plain-text form shown in the editor ----------
   One point per line:   Title: keyword, keyword / other way to say it, keyword
   "- " at the start makes it a sub-point, and [IR CA] limits it to those levels. */
const LV = { pa: 'PVT', ir: 'IR', ca: 'CA' } as Record<string, string>;
const VL: Record<string, string> = { pvt: 'pa', pa: 'pa', private: 'pa', ir: 'ir', ifr: 'ir', instrument: 'ir', ca: 'ca', com: 'ca', comm: 'ca', commercial: 'ca' };
export function toText(points: Point[]) {
  return points.map((p) => `${p.sub ? '- ' : ''}${p.levels ? `[${p.levels.map((l) => LV[l]).join(' ')}] ` : ''}${p.title}: ${p.groups.map((g) => g.alts.join(' / ')).join(', ')}`).join('\n');
}
export function fromText(t: string): Saved {
  const points: Saved['points'] = [];
  for (let line of t.split('\n')) {
    line = line.trim();
    if (!line) continue;
    let sub = false;
    if (/^[-•*]\s*/.test(line)) { sub = true; line = line.replace(/^[-•*]\s*/, ''); }
    let levels: string[] | undefined;
    const lm = line.match(/^\[([^\]]*)\]\s*/);
    if (lm) { levels = [...new Set(lm[1].toLowerCase().split(/[\s,]+/).map((x) => VL[x]).filter(Boolean))]; line = line.slice(lm[0].length); }
    const c = line.indexOf(':');
    const title = (c >= 0 ? line.slice(0, c) : line).trim();
    const kw = c >= 0 ? line.slice(c + 1) : title;
    const keywords = kw.split(',').map((g) => g.split('/').map((a) => a.trim()).filter(Boolean)).filter((g) => g.length);
    if (title && keywords.length) points.push({ title, ...(sub ? { sub } : {}), ...(levels?.length && levels.length < 3 ? { levels } : {}), keywords });
  }
  return { v: 1, points };
}
