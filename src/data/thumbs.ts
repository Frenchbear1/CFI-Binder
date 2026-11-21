// Animated thumbnails for the Interactives home, from David's Aviation Interactives launcher.
// Keys are sim ids (src/sims/<id>). Colours are the sims' avionics palette, drawn on a dark screen.
export const THUMBS: Record<string, string> = {
  wb:`<svg viewBox="0 0 220 130" aria-hidden="true" style="width:86%">
    <path d="M30 96 V70 L84 22 H150 V96 Z" fill="#7fd98a" fill-opacity=".1" stroke="#7fd98a" stroke-width="1.8"/>
    <line x1="20" x2="160" y1="22" y2="22" stroke="#e2574a" stroke-dasharray="3 3" stroke-opacity=".7"/>
    <line x1="104" y1="40" x2="98" y2="70" stroke="#5ccfe3" stroke-width="1.8"/><circle cx="98" cy="70" r="3.5" fill="#071014" stroke="#5ccfe3" stroke-width="1.5"/>
    <circle class="wbdot" cx="104" cy="40" r="6" fill="#e4ece9" stroke="#071014" stroke-width="2"/>
    <rect x="166" y="22" width="40" height="8" rx="2" fill="#9fb3b5" fill-opacity=".5"/><rect x="166" y="38" width="30" height="8" rx="2" fill="#5ccfe3" fill-opacity=".5"/>
    <rect x="166" y="54" width="34" height="8" rx="2" fill="#5ccfe3" fill-opacity=".5"/><rect x="166" y="70" width="46" height="8" rx="2" fill="#7fd98a" fill-opacity=".45"/>
    <line x1="210" x2="210" y1="16" y2="84" stroke="#ffb54a" stroke-width="1.6" stroke-dasharray="3 3"/>
    <rect x="14" y="110" width="196" height="5" fill="#3a4044"/><path d="M14 112 H120 Q150 112 176 96" fill="none" stroke="#5ccfe3" stroke-width="1.6" stroke-opacity=".7"/></svg>`,
  weather:`<svg viewBox="0 0 220 130" aria-hidden="true" style="width:86%">
    <path d="M150 34 L210 52 L192 112 L132 98 Z" fill="#e2574a" fill-opacity=".1" stroke="#e2574a" stroke-width="1.6"/>
    <g class="drift"><circle cx="168" cy="72" r="20" fill="rgba(80,190,90,.45)"/><circle cx="176" cy="66" r="12" fill="rgba(240,210,60,.7)"/><circle cx="172" cy="70" r="6" fill="rgba(226,70,60,.9)"/></g>
    <path d="M28 70 L182 78" stroke="#e4ece9" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="6 5"/>
    <path d="M28 70 L96 52 L120 30" fill="none" stroke="#5ccfe3" stroke-width="2.4"/>
    <circle cx="28" cy="70" r="6" fill="#7fd98a" stroke="#071014" stroke-width="2"/><circle cx="182" cy="78" r="6" fill="#e2574a" stroke="#071014" stroke-width="2"/>
    <circle cx="120" cy="30" r="6" fill="#7fd98a" stroke="#071014" stroke-width="2"/><circle cx="74" cy="104" r="6" fill="#5b9dff" stroke="#071014" stroke-width="2"/>
    <path d="M96 46 L91 56 H101 Z" fill="#5ccfe3"/></svg>`,
  stability:`<svg viewBox="0 0 220 130" aria-hidden="true" style="width:86%">
    <g class="rock"><path d="M196 62 L188 55 L160 52 L150 40 L110 39 L96 48 L28 54 L18 32 L8 32 L12 60 L40 64 L100 70 L150 70 L184 68 Z" fill="#1b2a30" stroke="#9fb3b5" stroke-width="1.4"/>
    <ellipse cx="22" cy="60" rx="14" ry="2.6" fill="#2a2650" stroke="#a99bff" stroke-width="1.4"/>
    <path d="M100 66 C110 61 130 61 140 66 C130 69 110 69 100 66 Z" fill="#22343b" stroke="#e4ece9" stroke-width="1.2"/>
    <line x1="128" y1="65" x2="128" y2="16" stroke="#5ccfe3" stroke-width="2.6"/><path d="M128 10 L123 19 H133 Z" fill="#5ccfe3"/>
    <line x1="136" y1="66" x2="136" y2="112" stroke="#e4ece9" stroke-width="2.6"/><path d="M136 118 L131 109 H141 Z" fill="#e4ece9"/>
    <line x1="22" y1="61" x2="22" y2="78" stroke="#a99bff" stroke-width="2.2"/><path d="M22 83 L18 76 H26 Z" fill="#a99bff"/>
    <circle cx="136" cy="66" r="4.5" fill="#e4ece9" stroke="#071014" stroke-width="1.5"/><circle cx="128" cy="65" r="3.6" fill="#071014" stroke="#5ccfe3" stroke-width="1.6"/></g></svg>`,
  vg:`<svg viewBox="0 0 220 130" aria-hidden="true" style="width:86%">
    <line x1="14" y1="78" x2="210" y2="78" stroke="#2c3f46" stroke-width="1.2"/>
    <line x1="14" y1="62" x2="210" y2="62" stroke="#8ea2a5" stroke-opacity=".6" stroke-dasharray="2 4"/>
    <path d="M14 78 Q70 72 104 22 H190 V104 H120 Q60 92 14 78 Z" fill="#7fd98a" fill-opacity=".1"/>
    <rect x="160" y="22" width="30" height="82" fill="#ffb54a" fill-opacity=".14"/>
    <path d="M14 78 Q70 72 104 22" fill="none" stroke="#e2574a" stroke-width="2.4"/><path d="M14 78 Q60 92 120 104" fill="none" stroke="#e2574a" stroke-width="2"/>
    <path d="M104 22 H190 M120 104 H190" stroke="#e4ece9" stroke-width="2"/><path d="M190 22 V104" stroke="#e2574a" stroke-width="2.4"/>
    <circle cx="104" cy="22" r="3.5" fill="#a99bff"/><circle class="vgdot" cx="120" cy="62" r="5" fill="#5ccfe3" stroke="#071014" stroke-width="2"/></svg>`,
  airspace:`<svg viewBox="0 0 220 130" aria-hidden="true" style="width:86%">
    <rect x="10" y="14" width="200" height="12" fill="#a99bff" fill-opacity=".16"/>
    <path d="M92 112 V90 H74 V76 H56 V62 H38 V40 H182 V62 H164 V76 H146 V90 H128 V112 Z" fill="#5b9dff" fill-opacity=".22"/>
    <path d="M92 112 V90 H74 V76 H56 V62 H38 V40 H182 V62 H164 V76 H146 V90 H128 V112" fill="none" stroke="#5b9dff" stroke-width="2"/>
    <path d="M10 98 H30 M190 98 H210" stroke="#8fe3b5" stroke-opacity=".6" stroke-width="1.4" stroke-dasharray="4 3"/>
    <rect x="10" y="112" width="200" height="8" fill="#2a2519" stroke="#6d6247"/>
    <g class="flowl"><path d="M14 84 H206" stroke="#ffb54a" stroke-width="1.6" fill="none"/></g>
    <text x="110" y="70" fill="#5b9dff" font-family="Barlow Condensed,sans-serif" font-weight="700" font-size="20" text-anchor="middle">B</text>
    <text x="110" y="24" fill="#a99bff" font-family="Barlow Condensed,sans-serif" font-weight="700" font-size="11" text-anchor="middle">A</text></svg>`,
  airfoil:`<svg viewBox="40 14 180 100" aria-hidden="true" style="width:86%">
    <g fill="none" stroke="#cfe0dd" stroke-opacity=".45" stroke-width="1.2" class="flowl">
      <path d="M40 30 C90 28 130 30 220 44"/><path d="M40 42 C80 40 110 36 150 44 S200 58 220 60"/>
      <path d="M40 54 C58 54 62 46 90 44 S150 52 200 70 L220 74"/><path d="M40 68 C60 68 70 70 100 72 S170 78 220 82"/>
      <path d="M40 82 C90 82 140 84 220 92"/><path d="M40 96 C90 96 140 98 220 104"/></g>
    <path d="M67.8 57.5 L68.3 56.3 L69.6 55.2 L71.5 54.3 L74.1 53.4 L77.3 52.7 L81.1 52.2 L85.5 51.8 L90.3 51.7 L95.7 51.8 L101.4 52.1 L107.4 52.7 L113.7 53.5 L120.2 54.6 L126.8 55.8 L133.5 57.2 L140.1 58.7 L146.7 60.3 L153.1 62.0 L159.3 63.7 L165.2 65.3 L170.7 67.0 L175.8 68.6 L180.5 70.0 L184.6 71.4 L188.2 72.6 L191.1 73.6 L193.5 74.5 L195.2 75.1 L196.2 75.4 L196.6 75.6 L196.2 75.5 L195.1 75.5 L193.4 75.4 L190.9 75.2 L187.8 75.0 L184.1 74.8 L179.8 74.5 L175.0 74.1 L169.7 73.8 L164.0 73.4 L158.0 72.9 L151.6 72.4 L145.1 71.9 L138.4 71.4 L131.6 70.8 L124.8 70.2 L118.1 69.6 L111.6 68.9 L105.3 68.2 L99.2 67.4 L93.6 66.7 L88.4 65.8 L83.6 65.0 L79.4 64.1 L75.8 63.1 L72.9 62.0 L70.5 60.9 L68.9 59.8 L68.0 58.7 Z" fill="#1b2a30" stroke="#e4ece9" stroke-width="1.6"/>
    <path d="M90 51.7 C120 52 150 59 196 75.4" fill="none" stroke="#ffb54a" stroke-width="2.4" stroke-opacity=".8"/></svg>`,
  vor:`<svg viewBox="-14 -14 228 228" aria-hidden="true">
    <defs><linearGradient id="tr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb54a" stop-opacity="0"/><stop offset="1" stop-color="#ffb54a" stop-opacity=".45"/></linearGradient></defs>
    <circle cx="100" cy="100" r="84" fill="rgba(92,207,227,.08)" stroke="#5ccfe3" stroke-opacity=".6" stroke-width="2"/>
    <g class="sweep"><path d="M100 100 L100 16 A84 84 0 0 0 27.25 58 Z" fill="url(#tr)"/><line x1="100" y1="100" x2="100" y2="16" stroke="#ffb54a" stroke-width="3"/></g>
    <polygon points="111,100 105.5,109.5 94.5,109.5 89,100 94.5,90.5 105.5,90.5" fill="#0b171c" stroke="#e4ece9" stroke-width="2"/>
    <text x="100" y="4" fill="#e4ece9" font-family="Barlow Condensed,sans-serif" font-weight="700" font-size="14" text-anchor="middle">N</text></svg>`,
};
