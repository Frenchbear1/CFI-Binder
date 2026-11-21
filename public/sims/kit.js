/* Shared lesson kit for every sim.
   Kit.mount({pause, sources:[keys]}) adds the Sources button + popup and the "Go deeper" row under #stepBody.
   Kit.step(step) shows that step's reference chips (step.refs = [keys]) and its deep-dive HTML (step.more).
   All references live in REFS below so every sim cites sources the same way. faa:true = FAA / CFR source. */
(function(){
const PHAK='https://www.faa.gov/regulationspolicies/handbooksmanuals/aviation/phak/';
const AFH='https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/';
const AIM='https://www.faa.gov/air_traffic/publications/atpubs/aim_html/';
const CFR=s=>'https://www.ecfr.gov/current/title-14/section-'+s;
const CFR23=s=>'https://www.ecfr.gov/on/2017-08-29/title-14/section-23.'+s; // pre-Amendment 23-64 Part 23 (most trainers were certified to it)
const REFS={
  acs:{lab:'ACS',t:'Private Pilot Airplane ACS (FAA-S-ACS-6C)',u:'https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',faa:1},
  acsI_E:{lab:'ACS PA.I.E',t:'Private Pilot ACS, Area I Task E: National Airspace System',u:'https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',faa:1},
  acsI_F:{lab:'ACS PA.I.F',t:'Private Pilot ACS, Area I Task F: Performance and Limitations',u:'https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',faa:1},
  acsVI_B:{lab:'ACS PA.VI.B',t:'Private Pilot ACS, Area VI Task B: Navigation Systems and Radar Services',u:'https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',faa:1},
  acsVII:{lab:'ACS PA.VII',t:'Private Pilot ACS, Area VII: Slow Flight and Stalls',u:'https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',faa:1},
  phak4:{lab:'PHAK 4',t:'PHAK (FAA-H-8083-25C) Ch 4: Principles of Flight (Bernoulli, Newton, airfoil design)',u:PHAK+'chapter-4-principles-flight',faa:1},
  phak5:{lab:'PHAK 5',t:'PHAK Ch 5: Aerodynamics of Flight (forces, AOA, stalls, ground effect, load factor)',u:PHAK+'chapter-5-aerodynamics-flight',faa:1},
  phak8:{lab:'PHAK 8',t:'PHAK Ch 8: Flight Instruments (pitot-static system, airspeed indicator)',u:PHAK+'chapter-8-flight-instruments',faa:1},
  phak15:{lab:'PHAK 15',t:'PHAK Ch 15: Airspace (classes, special use, other airspace areas)',u:PHAK+'chapter-15-airspace',faa:1},
  phak16:{lab:'PHAK 16',t:'PHAK Ch 16: Navigation (sectional charts, VOR, DME, VOR checks)',u:PHAK+'chapter-16-navigation',faa:1},
  afh2:{lab:'AFH 2',t:'Airplane Flying Handbook (FAA-H-8083-3C) Ch 2: Ground Operations (preflight, frost and ice removal)',u:AFH+'03_afh_ch2.pdf',faa:1},
  afh5:{lab:'AFH 5',t:'AFH Ch 5: Maintaining Aircraft Control: Upset Prevention and Recovery (slow flight, stalls, spins)',u:AFH+'06_afh_ch5.pdf',faa:1},
  ifh9:{lab:'IFH 9',t:'Instrument Flying Handbook (FAA-H-8083-15B) Ch 9: Navigation Systems (VOR, DME, HSI)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/instrument_flying_handbook',faa:1},
  aim113:{lab:'AIM 1-1-3',t:'AIM 1-1-3: VHF Omni-directional Range (VOR)',u:AIM+'chap1_section_1.html',faa:1},
  aim114:{lab:'AIM 1-1-4',t:'AIM 1-1-4: VOR Receiver Check',u:AIM+'chap1_section_1.html',faa:1},
  aim118:{lab:'AIM 1-1-8',t:'AIM 1-1-8: NAVAID Service Volumes',u:AIM+'chap1_section_1.html',faa:1},
  aim31:{lab:'AIM 3-1',t:'AIM Ch 3 Sec 1: Airspace, General (VFR minimums table 3-1-1)',u:AIM+'chap3_section_1.html',faa:1},
  aim32:{lab:'AIM 3-2',t:'AIM Ch 3 Sec 2: Controlled Airspace (Classes A, B, C, D, E)',u:AIM+'chap3_section_2.html',faa:1},
  aim33:{lab:'AIM 3-3',t:'AIM Ch 3 Sec 3: Class G Airspace',u:AIM+'chap3_section_3.html',faa:1},
  aim34:{lab:'AIM 3-4',t:'AIM Ch 3 Sec 4: Special Use Airspace (prohibited, restricted, MOA, warning, alert)',u:AIM+'chap3_section_4.html',faa:1},
  aim35:{lab:'AIM 3-5',t:'AIM Ch 3 Sec 5: Other Airspace Areas (TFR, MTR, Mode C veil context)',u:AIM+'chap3_section_5.html',faa:1},
  aim423:{lab:'AIM 4-1-20',t:'AIM 4-1-20: Transponder and ADS-B Out Operation',u:AIM+'chap4_section_1.html',faa:1},
  aim7:{lab:'AIM 7-1',t:'AIM Ch 7 Sec 1: Meteorology (icing, frost, turbulence, PIREPs)',u:AIM+'chap7_section_1.html',faa:1},
  p1:{lab:'14 CFR 1.1',t:'14 CFR 1.1: Definitions (night, controlled airspace)',u:CFR('1.1'),faa:1},
  p61_95:{lab:'§61.95',t:'14 CFR 61.95: Student pilots in Class B airspace',u:CFR('61.95'),faa:1},
  p61_57:{lab:'§61.57',t:'14 CFR 61.57: Recent flight experience (night passenger currency)',u:CFR('61.57'),faa:1},
  p91_119:{lab:'§91.119',t:'14 CFR 91.119: Minimum safe altitudes',u:CFR('91.119'),faa:1},
  p91_125:{lab:'§91.125',t:'14 CFR 91.125: ATC light signals',u:CFR('91.125'),faa:1},
  p91_137:{lab:'§91.137',t:'14 CFR 91.137: Temporary flight restrictions',u:CFR('91.137'),faa:1},
  p91_159:{lab:'§91.159',t:'14 CFR 91.159: VFR cruising altitude or flight level',u:CFR('91.159'),faa:1},
  p91_209:{lab:'§91.209',t:'14 CFR 91.209: Aircraft lights (sunset to sunrise)',u:CFR('91.209'),faa:1},
  p91_117:{lab:'§91.117',t:'14 CFR 91.117: Aircraft speed',u:CFR('91.117'),faa:1},
  p91_126:{lab:'§91.126',t:'14 CFR 91.126: Class G airspace operations',u:CFR('91.126'),faa:1},
  p91_129:{lab:'§91.129',t:'14 CFR 91.129: Class D airspace operations',u:CFR('91.129'),faa:1},
  p91_130:{lab:'§91.130',t:'14 CFR 91.130: Class C airspace operations',u:CFR('91.130'),faa:1},
  p91_131:{lab:'§91.131',t:'14 CFR 91.131: Class B airspace operations',u:CFR('91.131'),faa:1},
  p91_133:{lab:'§91.133',t:'14 CFR 91.133: Restricted and prohibited areas',u:CFR('91.133'),faa:1},
  p91_135:{lab:'§91.135',t:'14 CFR 91.135: Class A airspace operations',u:CFR('91.135'),faa:1},
  p91_155:{lab:'§91.155',t:'14 CFR 91.155: Basic VFR weather minimums',u:CFR('91.155'),faa:1},
  p91_157:{lab:'§91.157',t:'14 CFR 91.157: Special VFR weather minimums',u:CFR('91.157'),faa:1},
  p91_171:{lab:'§91.171',t:'14 CFR 91.171: VOR equipment check for IFR operations',u:CFR('91.171'),faa:1},
  p91_215:{lab:'§91.215',t:'14 CFR 91.215: ATC transponder and altitude reporting equipment',u:CFR('91.215'),faa:1},
  p91_225:{lab:'§91.225',t:'14 CFR 91.225: ADS-B Out equipment and use',u:CFR('91.225'),faa:1},
  p71:{lab:'14 CFR 71',t:'14 CFR Part 71: Designation of Class A, B, C, D and E airspace',u:'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-E/part-71',faa:1},
  p91appD:{lab:'Part 91 App D',t:'14 CFR Part 91 Appendix D: Airports and Class B areas with special rules (no SVFR, private pilot required)',u:'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/appendix-Appendix%20D%20to%20Part%2091',faa:1},
  cug:{lab:'Chart Users\' Guide',t:'FAA Aeronautical Chart Users\' Guide (sectional airspace symbols)',u:'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/aero_guide/',faa:1},
  adsb:{lab:'FAA ADS-B',t:'FAA: ADS-B Out airspace and equipment requirements',u:'https://www.faa.gov/air_traffic/technology/equipadsb/research/airspace',faa:1},
  sua:{lab:'FAA SUA',t:'FAA Special Use Airspace (live status by area)',u:'https://sua.faa.gov/',faa:1},
  tfr:{lab:'FAA TFRs',t:'FAA Temporary Flight Restrictions list',u:'https://tfr.faa.gov/',faa:1},
  p73:{lab:'14 CFR 73',t:'14 CFR Part 73: Special use airspace (restricted and prohibited areas)',u:'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-E/part-73',faa:1},
  p99:{lab:'14 CFR 99',t:'14 CFR Part 99: Security control of air traffic (ADIZ: flight plan, radio, transponder, position reports)',u:'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-99',faa:1},
  p99_7:{lab:'§99.7',t:'14 CFR 99.7: Special security instructions (stadium TFRs, NSAs made prohibited by NOTAM)',u:CFR('99.7'),faa:1},
  p93V:{lab:'14 CFR 93 V',t:'14 CFR Part 93 Subpart V: Washington, DC Metropolitan Area Special Flight Rules Area',u:'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-93/subpart-V',faa:1},
  p91_161:{lab:'§91.161',t:'14 CFR 91.161: Special awareness training for the DC SFRA',u:CFR('91.161'),faa:1},
  p91_141:{lab:'§91.141',t:'14 CFR 91.141: Flight restrictions in the proximity of the Presidential and other parties',u:CFR('91.141'),faa:1},
  p91_145:{lab:'§91.145',t:'14 CFR 91.145: Management of aircraft operations near aerial demonstrations and major sporting events',u:CFR('91.145'),faa:1},
  p105:{lab:'14 CFR 105',t:'14 CFR Part 105: Parachute operations',u:'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-105',faa:1},
  aim56:{lab:'AIM 5-6',t:'AIM Ch 5 Sec 6: National Security and Interception Procedures (ADIZ, DC SFRA/FRZ)',u:AIM+'chap5_section_6.html',faa:1},
  aim74:{lab:'AIM 7-4',t:'AIM Ch 7 Sec 4: Bird Hazards and Flight Over National Refuges, Parks, and Forests',u:AIM+'chap7_section_4.html',faa:1},
  ac91_36:{lab:'AC 91-36D',t:'AC 91-36D: VFR flight near noise-sensitive areas (2,000 ft AGL request over parks and refuges)',u:'https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentID/23156',faa:1},
  vfrChart:{lab:'FAA VFR charts',t:'FAA digital VFR sectional and terminal area charts (free, current)',u:'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/',faa:1},
  acsV_A:{lab:'ACS PA.V.A',t:'Private Pilot ACS, Area V Task A: Steep Turns',u:'https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',faa:1},
  caV_A:{lab:'Comm ACS CA.V.A',t:'Commercial Pilot Airplane ACS (FAA-S-ACS-7B), Area V Task A: Steep Turns',u:'https://www.faa.gov/training_testing/testing/acs',faa:1},
  afh3:{lab:'AFH 3',t:'AFH Ch 3: Basic Flight Maneuvers (turns, overbanking tendency)',u:AFH+'04_afh_ch3.pdf',faa:1},
  afh10:{lab:'AFH 10',t:'AFH Ch 10: Performance Maneuvers (steep turns, chandelles, lazy eights)',u:AFH+'11_afh_ch10.pdf',faa:1},
  p1_2:{lab:'14 CFR 1.2',t:'14 CFR 1.2: Abbreviations and symbols (VA, VNO, VNE, VFE, VS0, VS1)',u:CFR('1.2'),faa:1},
  p91_303:{lab:'§91.303',t:'14 CFR 91.303: Aerobatic flight',u:CFR('91.303'),faa:1},
  p91_307:{lab:'§91.307',t:'14 CFR 91.307: Parachutes (over 60° bank or 30° pitch with passengers)',u:CFR('91.307'),faa:1},
  p23_303:{lab:'old §23.303',t:'14 CFR 23.303 (pre-2017): Factor of safety, 1.5 (ultimate load)',u:CFR23('303'),faa:1},
  p23_335:{lab:'old §23.335',t:'14 CFR 23.335 (pre-2017): Design airspeeds VC, VD, VA',u:CFR23('335'),faa:1},
  p23_337:{lab:'old §23.337',t:'14 CFR 23.337 (pre-2017): Limit maneuvering load factors by category',u:CFR23('337'),faa:1},
  p23_341:{lab:'old §23.341',t:'14 CFR 23.341 (pre-2017): Gust load factors',u:CFR23('341'),faa:1},
  p23_345:{lab:'old §23.345',t:'14 CFR 23.345 (pre-2017): High-lift devices (flaps-down limit load)',u:CFR23('345'),faa:1},
  p23_1505:{lab:'old §23.1505',t:'14 CFR 23.1505 (pre-2017): Airspeed limitations VNE, VNO',u:CFR23('1505'),faa:1},
  p23_1507:{lab:'old §23.1507',t:'14 CFR 23.1507 (pre-2017): Operating maneuvering speed VO / VA',u:CFR23('1507'),faa:1},
  saib:{lab:'SAIB CE-11-17',t:'FAA Special Airworthiness Information Bulletin CE-11-17: Airplane maneuvering speed (copy hosted by SAFE)',u:'https://www.safepilots.org/library/contributed/Aerodynamics_SAIBManeuveringSpeed_2-02-11.pdf'},
  phak6:{lab:'PHAK 6',t:'PHAK Ch 6: Flight Controls (stabilator, anti-servo tab, trim systems)',u:'https://www.faa.gov/sites/faa.gov/files/08_phak_ch6.pdf',faa:1},
  phak10:{lab:'PHAK 10',t:'PHAK Ch 10: Weight and Balance (effects of CG position, adverse balance)',u:'https://www.faa.gov/sites/faa.gov/files/12_phak_ch10.pdf',faa:1},
  wbh:{lab:'W&B HB 1',t:'Aircraft Weight and Balance Handbook (FAA-H-8083-1B) Ch 1: Weight and Balance Control (stability and balance)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  p23_23:{lab:'old §23.23',t:'14 CFR 23.23 (pre-2017): Load distribution limits (CG range)',u:CFR23('23'),faa:1},
  p23_173:{lab:'old §23.173',t:'14 CFR 23.173 (pre-2017): Static longitudinal stability',u:CFR23('173'),faa:1},
  p23_181:{lab:'old §23.181',t:'14 CFR 23.181 (pre-2017): Dynamic stability (short period heavily damped)',u:CFR23('181'),faa:1},
  nasaCg:{lab:'NASA aircraft CG',t:'NASA Glenn Beginner\'s Guide: Aircraft center of gravity',u:'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/aircraft-center-of-gravity'},
  nasaCp:{lab:'NASA CP',t:'NASA Glenn Beginner\'s Guide: Center of pressure',u:'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/center-of-pressure/'},
  nasaTrim:{lab:'NASA trim',t:'NASA Glenn Beginner\'s Guide: Trimmed aircraft (wing and tail moments)',u:'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/trimmed-aircraft'},
  nasaWrong:{lab:'NASA lift myths',t:'NASA Glenn: Incorrect Lift Theory (equal transit time)',u:'https://www.grc.nasa.gov/www/k-12/airplane/wrong1.html'},
  nasaBern:{lab:'NASA Bernoulli',t:'NASA Glenn: Bernoulli and Newton',u:'https://www.grc.nasa.gov/www/k-12/airplane/bernnew.html'},
  airfoiltools:{lab:'NACA 2412 data',t:'AirfoilTools: NACA 2412 polars and geometry',u:'http://airfoiltools.com/airfoil/details?airfoil=naca2412-il'},
  acsI_C:{lab:'ACS PA.I.C',t:'Private Pilot ACS, Area I Task C: Weather Information',u:'https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',faa:1},
  acsVI_C:{lab:'ACS PA.VI.C',t:'Private Pilot ACS, Area VI Task C: Diversion',u:'https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf',faa:1},
  phak2:{lab:'PHAK 2',t:'PHAK Ch 2: Aeronautical Decision-Making (PAVE, 3P, personal minimums)',u:'https://www.faa.gov/sites/faa.gov/files/04_phak_ch2.pdf',faa:1},
  phak12:{lab:'PHAK 12',t:'PHAK Ch 12: Weather Theory (stability, fog, fronts, thunderstorms)',u:'https://www.faa.gov/sites/faa.gov/files/14_phak_ch12.pdf',faa:1},
  phak13:{lab:'PHAK 13',t:'PHAK Ch 13: Aviation Weather Services (METAR, TAF, PIREP, FB, AIRMET, SIGMET)',u:'https://www.faa.gov/sites/faa.gov/files/15_phak_ch13.pdf',faa:1},
  awh11:{lab:'AWH 11',t:'Aviation Weather Handbook (FAA-H-8083-28) Ch 11: Air Masses, Fronts, and the Wave Cyclone Model',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  awh18:{lab:'AWH 18',t:'Aviation Weather Handbook Ch 18: Weather and Obstructions to Visibility (fog, mist, haze)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  awh19:{lab:'AWH 19',t:'Aviation Weather Handbook Ch 19: Turbulence',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  awh22:{lab:'AWH 22',t:'Aviation Weather Handbook Ch 22: Thunderstorms (life cycle, hazards, avoidance)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  awh24:{lab:'AWH 24',t:'Aviation Weather Handbook Ch 24: Observations (METAR/SPECI, PIREPs)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  awh26:{lab:'AWH 26',t:'Aviation Weather Handbook Ch 26: Advisories (SIGMET, Convective SIGMET, AIRMET, CWA)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  awh27:{lab:'AWH 27',t:'Aviation Weather Handbook Ch 27: Forecasts (TAF, winds and temperatures aloft, convective outlook)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  aim712:{lab:'AIM 7-1-2',t:'AIM 7-1-2: FAA Weather Services (SPECI issuance criteria, Table 7-1-1)',u:AIM+'chap7_section_1.html',faa:1},
  aim715:{lab:'AIM 7-1-5',t:'AIM 7-1-5: Preflight Briefing (standard, abbreviated, outlook)',u:AIM+'chap7_section_1.html',faa:1},
  aim716:{lab:'AIM 7-1-6',t:'AIM 7-1-6: Inflight Aviation Weather Advisories (SIGMET, Convective SIGMET, AIRMET, CWA)',u:AIM+'chap7_section_1.html',faa:1},
  aim717:{lab:'AIM 7-1-7',t:'AIM 7-1-7: Categorical Ceiling and Visibility Conditions (VFR, MVFR, IFR, LIFR)',u:AIM+'chap7_section_1.html',faa:1},
  aim719:{lab:'AIM 7-1-9',t:'AIM 7-1-9: Flight Information Services (FIS-B datalink weather and its limits)',u:AIM+'chap7_section_1.html',faa:1},
  ac91_92:{lab:'AC 91-92',t:'AC 91-92: Pilot\'s Guide to a Preflight Briefing (self-briefing)',u:'https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_91-92.pdf',faa:1},
  p91_103:{lab:'§91.103',t:'14 CFR 91.103: Preflight action (all available information, weather reports and forecasts, alternatives)',u:CFR('91.103'),faa:1},
  p91_151:{lab:'§91.151',t:'14 CFR 91.151: Fuel requirements for flight in VFR conditions',u:CFR('91.151'),faa:1},
  awc:{lab:'AviationWeather.gov',t:'NOAA Aviation Weather Center: live METAR, TAF, PIREP, SIGMET, G-AIRMET and decoding help',u:'https://aviationweather.gov/'},
  spc:{lab:'SPC outlooks',t:'NOAA Storm Prediction Center: convective outlooks and risk categories',u:'https://www.spc.noaa.gov/products/outlook/'},
  phak11:{lab:'PHAK 11',t:'PHAK Ch 11: Aircraft Performance (density altitude, takeoff and landing charts, runway surface and slope, wind)',u:'https://www.faa.gov/sites/faa.gov/files/13_phak_ch11.pdf',faa:1},
  wbh2:{lab:'W&B HB 2',t:'Aircraft Weight and Balance Handbook (FAA-H-8083-1B) Ch 2: Weight and Balance Theory and Documentation (datum, arm, moment)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  wbh4:{lab:'W&B HB 4',t:'Aircraft Weight and Balance Handbook Ch 4: Single-Engine Aircraft Weight and Balance Computations (loading graph, moment envelope)',u:'https://www.faa.gov/regulations_policies/handbooks_manuals/aviation',faa:1},
  afh6:{lab:'AFH 6',t:'AFH Ch 6: Takeoffs and Departure Climbs (normal, crosswind, short-field and soft-field takeoffs)',u:AFH+'07_afh_ch6.pdf',faa:1},
  afh9:{lab:'AFH 9',t:'AFH Ch 9: Approaches and Landings (stabilized approach, short-field and soft-field landings)',u:AFH+'10_afh_ch9.pdf',faa:1},
  p91_9:{lab:'§91.9',t:'14 CFR 91.9: Civil aircraft flight manual, marking, and placard requirements (operating limitations)',u:CFR('91.9'),faa:1},
  caaSS7:{lab:'CAA SafetySense 7c',t:'UK CAA SafetySense Leaflet 7c: Aeroplane Performance (surface, slope and tailwind factors; ×1.33 takeoff, ×1.43 landing)',u:'https://caa.co.uk/publication/download/13044'},
  nwsDa:{lab:'NWS DA calculator',t:'National Weather Service: density altitude calculator',u:'https://www.weather.gov/epz/wxcalc_densityaltitude'},
  vorWiki:{lab:'VOR overview',t:'Wikipedia: VHF omnidirectional range (signal structure, DVOR)',u:'https://en.wikipedia.org/wiki/VHF_omnidirectional_range'},
};
let deepOpen=false,pauseFn=null,moreBtn,refsEl,deepEl;
function chip(k){const r=REFS[k];if(!r)return'';return`<a class="kit-chip${r.faa?'':' web'}" href="${r.u}" target="_blank" rel="noopener" title="${r.t.replace(/"/g,'&quot;')}">${r.lab}</a>`;}
function mount(opt){
  pauseFn=opt.pause||null;
  const hb=document.querySelector('.homebar');hb.classList.add('kit-hb');
  const sb=document.createElement('button');sb.type='button';sb.className='kit-srcbtn';sb.textContent='Sources';hb.appendChild(sb);
  const keys=opt.sources||[];const faa=keys.filter(k=>REFS[k]&&REFS[k].faa),web=keys.filter(k=>REFS[k]&&!REFS[k].faa);
  const row=k=>{const r=REFS[k];return`<a class="kr${r.faa?'':' web'}" href="${r.u}" target="_blank" rel="noopener"><span>${r.lab}</span><span class="kt">${r.t}</span></a>`;};
  const dlg=document.createElement('dialog');dlg.className='kit-dlg';dlg.setAttribute('aria-label','Sources');
  dlg.innerHTML=`<div class="kh"><span>Sources</span><button type="button" aria-label="Close">×</button></div><div class="kb">
    <h3>FAA</h3>${faa.map(row).join('')}${web.length?'<h3>Other</h3>'+web.map(row).join(''):''}
    <p class="kf">Training use only. Rules and charts change: check the current FAA publication and your aircraft's POH before flight.</p></div>`;
  document.body.appendChild(dlg);
  sb.onclick=()=>{pauseFn&&pauseFn();dlg.showModal();};
  dlg.querySelector('.kh button').onclick=()=>dlg.close();
  dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close();});
  const body=document.getElementById('stepBody');
  const r=document.createElement('div');r.className='kit-row';
  r.innerHTML='<button type="button" class="kit-more" aria-expanded="false" aria-controls="kitDeep">Go deeper</button><span class="kit-refs"></span>';
  deepEl=document.createElement('div');deepEl.className='kit-deep';deepEl.id='kitDeep';deepEl.hidden=true;
  body.after(r,deepEl);moreBtn=r.querySelector('.kit-more');refsEl=r.querySelector('.kit-refs');
  moreBtn.onclick=()=>{deepOpen=!deepOpen;if(deepOpen&&pauseFn)pauseFn();sync();};
}
let cur=null;
function sync(){const has=!!(cur&&cur.more);moreBtn.hidden=!has;moreBtn.setAttribute('aria-expanded',deepOpen&&has);moreBtn.textContent=deepOpen&&has?'Hide detail':'Go deeper';deepEl.hidden=!(deepOpen&&has);}
function step(st){cur=st;refsEl.innerHTML=(st.refs||[]).map(chip).join('');deepEl.innerHTML=st.more||'';deepEl.scrollTop=0;sync();}
window.Kit={mount,step,chip,REFS,isDeepOpen:()=>deepOpen};
})();
