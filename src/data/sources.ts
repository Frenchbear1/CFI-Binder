// Turns short reference strings into direct links.
// Supported: "PHAK 5-15", "AIM 8-1-5", "14 CFR 91.9", "POH Sec. 6" (no link), and named sources below.
const PHAK_FILES: Record<string, string> = {
  '5': 'https://www.faa.gov/sites/faa.gov/files/07_phak_ch5.pdf',
  '6': 'https://www.faa.gov/sites/faa.gov/files/08_phak_ch6.pdf',
};
const NAMED: Record<string, { label: string; href: string }> = {
  AFH: { label: 'AFH', href: 'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/airplane_handbook' },
  IFH: { label: 'IFH', href: 'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/instrument_flying_handbook' },
  ACS: { label: 'ACS', href: 'https://www.faa.gov/training_testing/testing/acs' },
  'BM washout': { label: 'Boldmethod', href: 'https://www.boldmethod.com/learn-to-fly/aircraft-systems/wing-washout-makes-your-plane-more-stable/' },
  'BM stability': { label: 'Boldmethod', href: 'https://www.boldmethod.com/learn-to-fly/aerodynamics/3-types-of-static-and-dynamic-stability-in-aircraft/' },
  'CFI Notebook': { label: 'CFI Notebook', href: 'https://www.cfinotebook.net/notebook/aerodynamics-and-performance/aircraft-stability' },
};

export function resolveRef(raw: string): { label: string; href?: string; doc?: string; page?: number } {
  const r = raw.trim();
  let m;
  if ((m = r.match(/^PHAK (\d+)-(\d+)$/)) && PHAK_FILES[m[1]]) return { label: r, href: `${PHAK_FILES[m[1]]}#page=${m[2]}`, doc: `phak-${m[1]}`, page: Number(m[2]) - 1 };
  if ((m = r.match(/^AIM (\d+)-(\d+)-(\d+)$/))) return { label: r, href: `https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap${m[1]}_section_${m[2]}.html#$paragraph${m[1]}-${m[2]}-${m[3]}` };
  if ((m = r.match(/^14 CFR (\d+)\.(\d+)$/))) return { label: r, href: `https://www.ecfr.gov/current/title-14/section-${m[1]}.${m[2]}` };
  if (/^POH\b/.test(r)) return { label: r };
  const named = Object.entries(NAMED).find(([k]) => r === k || r.startsWith(k + ' '));
  if (named) return { label: named[1].label + r.slice(named[0].length), href: named[1].href };
  return { label: r };
}
