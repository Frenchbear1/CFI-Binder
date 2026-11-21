// @ts-nocheck
// weather sim (from Aviation Interactives, now part of the binder). mount() runs it inside its block on the page:
// `document` here is scoped to that block (see ../runtime.js), and canvas colours follow the reading theme.
import { makeKit } from '../kit.js';
export function mount(root, document) {
const Kit = makeKit(document);

(()=>{
const TAU=Math.PI*2,rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const w360=d=>((d%360)+360)%360;
const $=id=>document.getElementById(id);
const FD='"Barlow Condensed","Arial Narrow",sans-serif',FB='"IBM Plex Sans",system-ui,sans-serif',FM='"IBM Plex Mono",ui-monospace,monospace';
const C={screen:'#071014',grid:'rgba(150,190,195,0.08)',ink:'#e4ece9',dim:'#8ea2a5',ref:'#5ccfe3',var:'#ffb54a',warn:'#e2574a',
  VFR:'#7fd98a',MVFR:'#5b9dff',IFR:'#e2574a',LIFR:'#ef7fd1',sierra:'#a99bff',tango:'#ffb54a',sig:'#e2574a',front:'#5b9dff'};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
// ---------- time ----------
const hhmm=t=>{let m=Math.round(t*60);m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0');};
const Z=t=>hhmm(t)+'Z';
const loc=t=>{const a=hhmm(t-5),b=hhmm(t-4);return a.slice(0,2)+':'+a.slice(2)+' CDT · '+b.slice(0,2)+':'+b.slice(2)+' EDT';};
const ageTxt=m=>m<60?m+' min old':Math.floor(m/60)+' h '+String(m%60).padStart(2,'0')+' min old';
// ---------- geography (NM, x east, y north) ----------
const LON0=-90.35,LAT0=40.85,KX=46.0,W_NM=4.5*KX,H_NM=1.9*60;
const P=(lat,lon)=>({x:(lon-LON0)*KX,y:(LAT0-lat)*60});
const ST={SPI:{n:'Springfield',lat:39.844,lon:-89.678},CMI:{n:'Champaign',lat:40.040,lon:-88.278},HUF:{n:'Terre Haute',lat:39.452,lon:-87.308},
  LAF:{n:'Lafayette',lat:40.412,lon:-86.937},IND:{n:'Indianapolis',lat:39.717,lon:-86.294}};
for(const k in ST)Object.assign(ST[k],P(ST[k].lat,ST[k].lon));
const ORDER=['SPI','CMI','HUF','LAF','IND'];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const brg=(a,b)=>w360(deg(Math.atan2(b.x-a.x,-(b.y-a.y))));
const radial=(s,b,d)=>({x:ST[s].x+d*Math.sin(rad(b)),y:ST[s].y-d*Math.cos(rad(b))});
const CRS=brg(ST.SPI,ST.IND),ROUTE=dist(ST.SPI,ST.IND),TAS=115;

// ---------- weather "truth": thunderstorm cells and the front ----------
const MOVE={dir:50,kt:30};
const CELLS=[{id:'A',t0:15.35,t1:18.6,lat:39.35,lon:-86.85,r:9},{id:'B',t0:15.6,t1:17.9,lat:39.22,lon:-86.62,r:7},{id:'C',t0:15.8,t1:17.6,lat:39.56,lon:-87.08,r:6}];
CELLS.forEach(c=>Object.assign(c,P(c.lat,c.lon)));
function cellAt(c,t){if(t<c.t0||t>c.t1)return null;const d=(t-c.t0)*MOVE.kt;
  const r=c.r*clamp((t-c.t0)/.6,0,1)*Math.sqrt(clamp((c.t1-t)/.7,0,1));if(r<.4)return null;
  return{x:c.x+d*Math.sin(rad(MOVE.dir)),y:c.y-d*Math.cos(rad(MOVE.dir)),r,id:c.id};}
const frontLon=(t,lat)=>-91.4+.17*(t-11)+(lat-39.9)*.55;

// ---------- token decoder for METAR / SPECI / TAF ----------
const WXC={TS:'thunderstorm',SH:'showers of',FZ:'freezing',MI:'shallow',BC:'patches of',DR:'low drifting',BL:'blowing',
  RA:'rain',DZ:'drizzle',SN:'snow',GR:'hail',GS:'small hail',PL:'ice pellets',UP:'unknown precipitation',BR:'mist (visibility 5/8 SM or more)',
  FG:'fog (visibility below 5/8 SM)',HZ:'haze',FU:'smoke',VA:'volcanic ash',DU:'dust',SA:'sand',SQ:'squall',FC:'funnel cloud'};
const DIRS={N:'north',NE:'northeast',E:'east',SE:'southeast',S:'south',SW:'southwest',W:'west',NW:'northwest'};
const RMKW={AO2:'Automated station with a precipitation sensor (no human observer).',CB:'Cumulonimbus (thunderstorm cloud).',TCU:'Towering cumulus: building convection.',
  DSNT:'Distant: more than 10 SM from the station.',MOV:'Moving (toward the direction that follows).',OHD:'Overhead.',OCNL:'Occasional.',FRQ:'Frequent.',
  LTGICCG:'Lightning in cloud and cloud to ground.',TS:'Thunderstorm.',PK:'Peak wind remark: highest gust since the last report.',WND:'(peak WIND)'};
function wxDec(w){const m=/^(\+|-|VC)?(MI|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|GR|GS|PL|UP|BR|FG|HZ|FU|VA|DU|SA|SQ|FC)*)$/.exec(w);
  if(!m||(!m[2]&&!m[3]))return null;const ph=(m[3].match(/../g)||[]).map(x=>WXC[x]);let s='';
  if(m[1]==='-')s+='Light ';if(m[1]==='+')s+='Heavy ';
  if(m[2]==='TS')s+=(ph.length?'thunderstorm with '+ph.join(' and '):'thunderstorm at the airport (thunder heard)');
  else s+=(m[2]?WXC[m[2]]+' ':'')+ph.join(' and ');
  if(m[1]==='VC')s='In the vicinity (5–10 SM from the airport): '+s.trim().toLowerCase();
  s=s.trim();return s.charAt(0).toUpperCase()+s.slice(1)+'.';}
function decodeRaw(raw,kind){
  const out=[];let rmk=false,period=false,hdr=0;
  raw.split(/\s+/).forEach(w=>{
    if(kind==='TAF'&&/^(FM\d{6}|TEMPO|PROB\d\d|BECMG)$/.test(w))out.push(['\n','']);
    let d='',m;
    if(w==='METAR')d='Routine hourly observation.';
    else if(w==='SPECI')d='Special observation: issued between hourly reports because conditions crossed a threshold.';
    else if(w==='TAF')d='Terminal Aerodrome Forecast: conditions expected within 5 SM of the runways.';
    else if(w==='AMD')d='Amended: replaces the earlier TAF, which no longer fit the weather.';
    else if(w==='RMK'){rmk=true;d='Remarks follow.';}
    else if(/^K[A-Z]{3}$/.test(w)&&ST[w.slice(1)])d=w+': '+ST[w.slice(1)].n+'.';
    else if((m=/^(\d\d)(\d\d)(\d\d)Z$/.exec(w)))d=(kind==='TAF'?'Issued':'Observed')+' on the '+m[1]+'th at '+m[2]+m[3]+'Z ('+loc(+m[2]+m[3]/60)+').';
    else if((m=/^(\d\d)(\d\d)\/(\d\d)(\d\d)$/.exec(w))){
      const a=`the ${m[1]}th ${m[2]}00Z`,b=`the ${m[3]}th ${m[4]}00Z`;
      d=period?`During ${a} to ${b}.`:(hdr++?'':'')+`Valid from ${a} to ${b}.`;period=false;}
    else if((m=/^FM(\d\d)(\d\d)(\d\d)$/.exec(w)))d=`FROM ${m[2]}${m[3]}Z: a rapid change. This group replaces everything before it.`;
    else if(w==='TEMPO'){period=true;d='Temporary: changes lasting under 1 hour each, together less than half the period.';}
    else if((m=/^PROB(\d\d)$/.exec(w))){period=true;d=`${m[1]}% probability of the conditions that follow, in the period given.`;}
    else if(w==='BECMG'){period=true;d='Becoming: a gradual change during the period.';}
    else if((m=/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(w)))d=(+m[2]===0?'Calm wind.':`Wind from ${m[1]==='VRB'?'variable directions':m[1]+'° true'} at ${+m[2]} kt${m[3]?', gusting '+(+m[3])+' kt':''}.`)+(m[3]&&+m[3]>=35?' Strong gusts: expect a gust front.':'');
    else if((m=/^(\d{3})(\d{2,3})\/(\d\d)(\d\d)$/.exec(w)))d=`Peak gust ${+m[2]} kt from ${m[1]}° at ${m[3]}${m[4]}Z.`;
    else if((m=/^(P)?(\d+)(?:\/(\d+))?SM$/.exec(w)))d=m[1]?'Visibility more than 6 SM.':`Visibility ${m[3]?m[2]+'/'+m[3]:m[2]} statute mile${!m[3]&&+m[2]===1?'':'s'}.`;
    else if((m=/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/.exec(w))){const h=(+m[2]*100).toLocaleString('en-US');
      d={FEW:`Few (1–2 eighths of the sky) at ${h} ft AGL.`,SCT:`Scattered (3–4 eighths) at ${h} ft AGL.`,BKN:`Broken (5–7 eighths) at ${h} ft AGL. Broken is a ceiling.`,
         OVC:`Overcast at ${h} ft AGL. This is the ceiling.`,VV:`Sky obscured: vertical visibility ${h} ft. Counts as the ceiling.`}[m[1]]+(m[3]==='CB'?' Cumulonimbus: thunderstorm cloud.':m[3]==='TCU'?' Towering cumulus.':'');}
    else if((m=/^(M?\d\d)\/(M?\d\d)$/.exec(w))){const t=+m[1].replace('M','-'),dp=+m[2].replace('M','-'),sp=t-dp;
      d=`Temperature ${t} °C, dew point ${dp} °C. Spread ${sp} °C`+(sp<=2?': the air is nearly saturated, so expect fog or low cloud.':'.');}
    else if((m=/^A(\d\d)(\d\d)$/.exec(w)))d=`Altimeter setting ${m[1]}.${m[2]} inHg.`;
    else if((m=/^SLP(\d)(\d\d)$/.exec(w)))d=`Sea-level pressure ${(+m[1]>=5?'9':'10')+m[1]+m[2].slice(0,1)}.${m[2].slice(1)} hPa.`;
    else if(/^(TS|RA)[BE]\d\d/.test(w)){const parts=[...w.matchAll(/(TS|RA)(B|E)(\d\d)/g)].map(x=>`${x[1]==='TS'?'thunderstorm':'rain'} ${x[2]==='B'?'began':'ended'} at :${x[3]}`);d=parts.join(', ')+'.';d=d.charAt(0).toUpperCase()+d.slice(1);}
    else if(rmk&&RMKW[w])d=RMKW[w];
    else if(rmk&&DIRS[w])d='To the '+DIRS[w]+'.';
    else{const x=wxDec(w);if(x)d=x;}
    out.push([w,d]);});
  return out;}
function catOf(raw){let vis=99,cig=99999,m;
  raw.split(/\s+/).forEach(w=>{if(w==='RMK')return;if((m=/^(P)?(\d+)(?:\/(\d+))?SM$/.exec(w)))vis=m[1]?7:(m[3]?+m[2]/+m[3]:+m[2]);
    if((m=/^(BKN|OVC|VV)(\d{3})/.exec(w)))cig=Math.min(cig,+m[2]*100);});
  return(cig<500||vis<1)?'LIFR':(cig<1000||vis<3)?'IFR':(cig<=3000||vis<=5)?'MVFR':'VFR';}

// ---------- products (synthetic, internally consistent) ----------
const RAW_OBS=`METAR KSPI 141153Z 17004KT 2SM BR OVC006 20/19 A2994 RMK AO2 SLP131
METAR KSPI 141253Z 18004KT 1/2SM FG VV002 20/20 A2995 RMK AO2 SLP134
METAR KSPI 141353Z 19006KT 2SM BR OVC007 21/20 A2996 RMK AO2 SLP137
SPECI KSPI 141424Z 20007KT 4SM BR BKN012 22/20 A2996 RMK AO2
METAR KSPI 141453Z 20008KT 6SM HZ BKN018 23/20 A2996 RMK AO2 SLP138
SPECI KSPI 141519Z 21009KT 8SM SCT026 24/20 A2996 RMK AO2
METAR KSPI 141553Z 21010KT 10SM SCT032 26/20 A2995 RMK AO2 SLP135
METAR KSPI 141653Z 22012G18KT 10SM SCT040 28/20 A2993 RMK AO2 SLP128
METAR KSPI 141753Z 22013G20KT 10SM SCT045 29/20 A2991 RMK AO2 SLP122
METAR KSPI 141853Z 23014G22KT 10SM SCT050 BKN250 30/20 A2989 RMK AO2 SLP115
METAR KSPI 141953Z 24014G24KT 10SM SCT050CB BKN250 30/21 A2987 RMK AO2 CB W MOV E
METAR KCMI 141153Z 18005KT 3SM BR OVC009 21/20 A2993 RMK AO2
METAR KCMI 141253Z 18005KT 3SM BR OVC010 21/20 A2994 RMK AO2
METAR KCMI 141353Z 19007KT 5SM HZ BKN016 22/20 A2995 RMK AO2
METAR KCMI 141453Z 20009KT 7SM SCT025 24/20 A2995 RMK AO2
METAR KCMI 141553Z 21011KT 10SM SCT035 26/20 A2994 RMK AO2
METAR KCMI 141653Z 22012G19KT 10SM SCT040 28/20 A2992 RMK AO2 CB DSNT SE
METAR KCMI 141753Z 22013KT 10SM SCT045 29/20 A2990 RMK AO2 CB DSNT E
METAR KCMI 141853Z 23014G21KT 10SM SCT050 30/20 A2988 RMK AO2
METAR KCMI 141953Z 23014G22KT 10SM SCT050 BKN250 30/20 A2987 RMK AO2
METAR KHUF 141153Z 19006KT 7SM HZ SCT040 22/19 A2993 RMK AO2
METAR KHUF 141253Z 19007KT 7SM HZ SCT040 23/19 A2993 RMK AO2
METAR KHUF 141353Z 20008KT 8SM SCT040 25/20 A2993 RMK AO2
METAR KHUF 141453Z 21010KT 10SM SCT045 27/21 A2992 RMK AO2 TCU NE
METAR KHUF 141553Z 21012G20KT 10SM SCT045CB 28/21 A2991 RMK AO2 CB NE MOV NE
METAR KHUF 141653Z 22012KT 10SM SCT050 BKN250 29/21 A2990 RMK AO2 CB DSNT NE
METAR KHUF 141753Z 22011KT 10SM SCT050 BKN250 29/21 A2990 RMK AO2
METAR KHUF 141853Z 23012KT 10SM SCT050 30/21 A2989 RMK AO2
METAR KHUF 141953Z 23013KT 10SM SCT050 30/21 A2988 RMK AO2
METAR KLAF 141154Z 18008KT 10SM SCT045 23/18 A2992 RMK AO2
METAR KLAF 141254Z 18008KT 10SM SCT045 24/18 A2992 RMK AO2
METAR KLAF 141354Z 19009KT 10SM SCT045 25/19 A2992 RMK AO2
METAR KLAF 141454Z 20010KT 10SM SCT050 26/19 A2991 RMK AO2
METAR KLAF 141554Z 20011KT 10SM SCT050 27/19 A2991 RMK AO2
METAR KLAF 141654Z 21012KT 10SM SCT050 BKN250 28/19 A2990 RMK AO2 CB DSNT S MOV NE
METAR KLAF 141754Z 21012KT 10SM SCT050 BKN250 28/19 A2990 RMK AO2 CB DSNT SE MOV NE
METAR KLAF 141854Z 22011KT 10SM SCT050 28/19 A2990 RMK AO2
METAR KLAF 141954Z 22012KT 10SM SCT050 29/19 A2989 RMK AO2
METAR KIND 141154Z 19010KT 10SM SCT040 24/19 A2992 RMK AO2 SLP128
METAR KIND 141254Z 19011KT 10SM SCT040 25/19 A2992 RMK AO2 SLP128
METAR KIND 141354Z 20012KT 10SM SCT045 26/20 A2992 RMK AO2 SLP127
METAR KIND 141454Z 20013G20KT 10SM SCT045 28/21 A2991 RMK AO2 TCU SW
METAR KIND 141554Z 21013G22KT 10SM SCT045TCU BKN250 29/21 A2990 RMK AO2 CB DSNT SW MOV NE
SPECI KIND 141615Z 22015G25KT 10SM TS SCT040CB BKN250 28/21 A2990 RMK AO2 TSB12 FRQ LTGICCG SW TS SW MOV NE
SPECI KIND 141638Z 26026G41KT 2SM +TSRA BR BKN025CB OVC080 21/19 A2995 RMK AO2 PK WND 26045/1634 TSB12RAB29
SPECI KIND 141715Z 24012KT 6SM -RA BKN035 OVC090 21/19 A2994 RMK AO2 TSE07 TS DSNT NE MOV NE
METAR KIND 141754Z 23010KT 10SM -RA SCT040 BKN090 22/19 A2993 RMK AO2
METAR KIND 141854Z 22011KT 10SM SCT045 BKN250 25/19 A2992 RMK AO2
METAR KIND 141954Z 22012KT 10SM SCT050 BKN250 27/19 A2991 RMK AO2`;
const OBS={};ORDER.forEach(s=>OBS[s]=[]);
RAW_OBS.split('\n').forEach(raw=>{const w=raw.split(' ');const s=w[1].slice(1),m=/^\d\d(\d\d)(\d\d)Z$/.exec(w[2]);
  OBS[s].push({raw,kind:w[0],t:+m[1]+m[2]/60,cat:catOf(raw),toks:decodeRaw(raw,'METAR')});});
const obsAt=(s,t)=>{let o=null;for(const x of OBS[s])if(x.t<=t+1e-6)o=x;return o;};

const TAFS=[
 {stn:'SPI',t:11.33,raw:'TAF KSPI 141120Z 1412/1512 18005KT 1SM BR OVC004 TEMPO 1412/1414 1/2SM FG VV002 FM141500 20009KT P6SM SCT025 FM142000 23013G22KT P6SM VCTS SCT050CB FM150200 29010KT P6SM SCT060',
  seg:[[12,15,'IFR'],[15,20,'VFR'],[20,26,'VFR']],ovl:[[12,14,'LIFR','TEMPO']]},
 {stn:'CMI',t:11.33,raw:'TAF KCMI 141120Z 1412/1512 18006KT 3SM BR OVC009 FM141400 20009KT P6SM SCT025 FM142100 24012G20KT P6SM VCTS BKN050CB',
  seg:[[12,14,'IFR'],[14,21,'VFR'],[21,36,'VFR']],ovl:[]},
 {stn:'LAF',t:11.33,raw:'TAF KLAF 141120Z 1412/1512 18008KT P6SM SCT045 FM141600 21012G20KT P6SM SCT050 FM142200 24012KT P6SM VCTS BKN050CB',
  seg:[[12,36,'VFR']],ovl:[]},
 {stn:'IND',t:11.5,raw:'TAF KIND 141130Z 1412/1518 19010KT P6SM SCT040 FM141600 21013G22KT P6SM SCT045 BKN250 PROB30 1419/1423 3SM TSRA BKN030CB FM150000 26012KT P6SM SCT060',
  seg:[[12,42,'VFR']],ovl:[[19,23,'MVFR','PROB30 TSRA']]},
 {stn:'IND',t:16.3,amd:1,raw:'TAF AMD KIND 141618Z 1416/1518 22015G25KT P6SM VCTS SCT040CB BKN250 TEMPO 1416/1418 2SM +TSRA BR BKN025CB FM141900 23012KT P6SM VCTS SCT050CB BKN250 FM150000 26012KT P6SM SCT060',
  seg:[[16.3,42,'VFR']],ovl:[[16.3,18,'IFR','TEMPO +TSRA']]},
];
TAFS.forEach(f=>f.toks=decodeRaw(f.raw,'TAF'));
const tafAt=(s,t)=>{let o=null;for(const f of TAFS)if(f.stn===s&&f.t<=t+1e-6)o=f;return o;};
function tafCat(f,t){let c=null,o=null;for(const s of f.seg)if(t>=s[0]&&t<s[1])c=s[2];for(const s of f.ovl)if(t>=s[0]&&t<s[1])o=s;return{c,o};}

// hand-decoded products: [text, decode]; '\n' = line break
const N=['\n',''];
const PIREPS=[
 {id:'P1',t:13.87,at:radial('SPI',90,20),toks:[['UA','Routine pilot report.'],['/OV SPI090020','Over: 20 NM east of Springfield (090° radial, 20 NM). Right on your route.'],['/TM 1352','Time 1352Z.'],['/FL045','Altitude 4,500 ft MSL. PIREP heights are MSL.'],['/TP PA28','Aircraft: Piper Cherokee/Arrow.'],
  ['/SK OVC007-TOP030','Sky: overcast, base about 700 ft AGL, tops 3,000 ft MSL. A thin fog-and-stratus deck.'],['/TA 18','Air temperature +18 °C.'],['/TB NEG','No turbulence.'],['/RM SMOOTH ABV TOPS','Remark: smooth above the tops.']]},
 {id:'P2',t:14.67,at:radial('HUF',0,15),toks:[['UA','Routine pilot report.'],['/OV HUF360015','Over: 15 NM north of Terre Haute. On your route.'],['/TM 1440','Time 1440Z.'],['/FL065','6,500 ft MSL.'],['/TP BE36','Aircraft: Beech Bonanza.'],
  ['/SK SCT045-TOP060','Scattered cumulus, bases 4,500 ft, tops 6,000 ft MSL.'],['/TA 13','+13 °C.'],['/TB LGT-MOD 040-070','Light to moderate turbulence from 4,000 to 7,000 ft MSL. Expect it in your cruise band.'],['/RM BUILDING CU W OF IND','Remark: cumulus building west of Indianapolis. An early sign the air is unstable.']]},
 {id:'P4',t:15.25,at:radial('CMI',180,10),toks:[['UA','Routine pilot report.'],['/OV CMI180010','10 NM south of Champaign.'],['/TM 1515','Time 1515Z.'],['/FL055','5,500 ft MSL.'],['/TP C172','Cessna 172.'],['/TA 15','+15 °C.'],['/TB LGT CHOP','Light chop: slight, rapid, rhythmic bumps without real altitude change.'],['/RM HAZE VIS 8SM','Haze, flight visibility about 8 SM.']]},
 {id:'P3',t:16.13,urgent:1,at:radial('IND',230,25),toks:[['UUA','URGENT pilot report: severe turbulence, severe icing, hail, low-level wind shear, tornado or volcanic ash.'],['/OV IND230025','25 NM southwest of Indianapolis, on your route.'],['/TM 1608','Time 1608Z.'],['/FL075','7,500 ft MSL.'],['/TP C182','Cessna 182.'],['/TB SEV','SEVERE turbulence: large, abrupt changes in attitude and altitude, momentarily out of control.'],['/RM DEVIATING N AROUND TS LOST 600 FT','Deviating north around a thunderstorm, lost 600 ft.']]},
];
const FBS=[
 {id:'FB1',t:7.98,use:[9,14],data:{SPI:[[180,10],[200,16,15],[220,20,10],[240,25,5]],IND:[[190,12],[200,15,16],[210,18,11],[230,22,6]]},hdr:'DATA BASED ON 140600Z · VALID 141200Z · FOR USE 0900–1400Z'},
 {id:'FB2',t:13.98,use:[14,21],data:{SPI:[[190,12],[210,19,16],[230,22,11],[240,27,6]],IND:[[200,14],[210,17,17],[220,20,12],[230,24,7]]},hdr:'DATA BASED ON 141200Z · VALID 141800Z · FOR USE 1400–2100Z'},
];
const FBALT=[3000,6000,9000,12000];
const fbAt=t=>{let o=null;for(const f of FBS)if(f.t<=t)o=f;return o;};
function fbCode(w){const[d,s,tp]=w;return String(d/10).padStart(2,'0')+String(s).padStart(2,'0')+(tp===undefined?'':(tp>=0?'+':'-')+String(Math.abs(tp)).padStart(2,'0'));}
function fbToks(f){const t=[['FB',`Winds and temperatures aloft forecast, issued ${Z(f.t)}.`],[f.hdr,'Which model run, the valid time, and the window to use it in. Outside the window, use the next forecast.'],N,['FT','Altitude row: feet MSL.']];
  FBALT.forEach(a=>t.push([String(a),`${a.toLocaleString('en-US')} ft MSL column.`+(a===3000?' No temperature is given at 3,000 ft.':'')]));
  ['SPI','IND'].forEach(s=>{t.push(N,[s,`${ST[s].n} forecast point.`]);f.data[s].forEach((w,i)=>t.push([fbCode(w),`${FBALT[i].toLocaleString('en-US')} ft: wind from ${w[0]}° true at ${w[1]} kt`+(w[2]===undefined?'.':`, temperature ${w[2]>0?'+':''}${w[2]} °C.`)]));});
  return t;}
const ADV=[
 {id:'AS1',type:'S',t:8.75,end:15,poly:[[40.45,-90.2],[40.45,-87.9],[39.4,-87.9],[39.3,-90.2]],toks:[['WAUS43 KKCI 140845','AIRMET bulletin from the Aviation Weather Center (KKCI), issued the 14th at 0845Z.'],N,['AIRMET SIERRA','Sierra = IFR conditions and mountain obscuration.'],['UPDT 2','Second update of this issuance cycle.'],['FOR IFR VALID UNTIL 141500','Valid until 1500Z.'],N,['AIRMET IFR...IL IN','States affected: Illinois and Indiana.'],N,['FROM 40NW SPI TO 20N CMI TO 30S CMI TO 40S SPI TO 40NW SPI','Area corners. Real AIRMETs use VOR identifiers; this training set uses the map\'s airports.'],N,['CIG BLW 010/VIS BLW 3SM BR/FG.','Ceilings below 1,000 ft and/or visibility below 3 SM in mist and fog.'],['CONDS ENDG 14-15Z.','Conditions ending 1400–1500Z.']]},
 {id:'AT1',type:'T',t:8.75,end:15,poly:[[40.85,-90.4],[40.85,-85.5],[38.9,-85.5],[38.9,-90.4]],toks:[['AIRMET TANGO','Tango = moderate turbulence, sustained surface winds over 30 kt, low-level wind shear.'],['UPDT 1 FOR TURB VALID UNTIL 141500','Valid until 1500Z.'],N,['AIRMET TURB...IL IN','Illinois and Indiana.'],N,['MOD TURB BLW 070.','Moderate turbulence below 7,000 ft MSL.'],['CONDS CONTG BYD 15Z THRU 21Z.','Conditions continuing beyond 1500Z through 2100Z.']]},
 {id:'AS2',type:'S',t:14.75,end:21,poly:null,toks:[['AIRMET SIERRA UPDT 3 FOR IFR VALID UNTIL 142100','New issuance at 1445Z, valid until 2100Z. AIRMETs are issued at 0245, 0845, 1445 and 2045Z.'],N,['.','No area listed.'],N,['NO SGFNT IFR EXP OUTSIDE OF CNVTV ACT.','No significant IFR expected outside convective activity. The morning IFR AIRMET is gone, but storms can still bring IFR.']]},
 {id:'AT2',type:'T',t:14.75,end:21,poly:[[40.85,-90.4],[40.85,-85.5],[38.9,-85.5],[38.9,-90.4]],toks:[['AIRMET TANGO UPDT 2 FOR TURB VALID UNTIL 142100','New issuance at 1445Z, valid until 2100Z.'],N,['AIRMET TURB...IL IN','Illinois and Indiana.'],N,['MOD TURB BLW 080.','Moderate turbulence below 8,000 ft MSL. All three VFR cruise altitudes are inside it.'],['CONDS CONTG BYD 21Z THRU 03Z.','Continuing past 2100Z.']]},
];
const SIGS=[
 {id:'C36',t:15.92,end:17.92,poly:[[39.95,-87.25],[40.15,-86.2],[39.45,-85.95],[39.05,-86.95]],toks:[['CONVECTIVE SIGMET 36C','Convective SIGMET number 36, Central region. Issued hourly at 55 past the hour when criteria are met.'],N,['VALID UNTIL 1755Z','Valid 2 hours.'],N,['IN IL','Indiana and Illinois.'],N,['FROM 30NE HUF-40E IND? ','Polygon corners (shown red on the map).'],N,['AREA SCT EMBD TS','An area of scattered thunderstorms, some embedded in other cloud: you may not see them.'],['MOV FROM 23030KT.','Moving from 230° at 30 kt: toward Indianapolis.'],['TOPS TO FL420.','Tops to 42,000 ft. No light airplane goes over these.']]},
 {id:'C37',t:16.92,end:18.92,poly:[[40.25,-86.85],[40.45,-85.6],[39.7,-85.5],[39.35,-86.45]],toks:[['CONVECTIVE SIGMET 37C','Next hourly issuance. 36C is replaced.'],N,['VALID UNTIL 1855Z','Valid 2 hours.'],N,['IN','Indiana.'],N,['AREA SCT TS MOV FROM 23030KT. TOPS TO FL450.','Scattered storms still moving northeast, now past Indianapolis.'],N,['HAIL TO 1 IN...WIND GUSTS TO 50KT POSS.','Hail to 1 inch and 50 kt gusts possible: severe criteria.']]},
];
SIGS[0].toks[6]=['FROM 25NE HUF-40E IND-30SE IND-25S HUF-25NE HUF','Polygon corners (red on the map). Real SIGMETs use VOR identifiers; this set uses the map\'s airports.'];
const OUT={id:'OUT',t:13.0,slgt:[[40.6,-87.6],[40.6,-85.4],[38.9,-85.4],[38.9,-87.9]],mrgl:[[40.95,-89.5],[40.95,-85.4],[38.75,-85.4],[38.75,-89.8]],
 toks:[['SPC DAY 1 CONVECTIVE OUTLOOK 1300Z','Storm Prediction Center outlook for today, issued 1300Z.'],N,['SLGT RISK','Slight risk (level 2 of 5) over central Indiana: scattered severe storms possible.'],['CENTRAL IN','Covers Indianapolis.'],N,['MRGL RISK','Marginal risk (level 1 of 5) back to central Illinois.'],N,
  ['SCT TS DVLPG BY 18-20Z','Scattered storms expected to develop by 1800–2000Z.'],['AHEAD OF COLD FRONT','Lift comes from the front approaching from the west.'],['IN VERY MOIST UNSTABLE AIR','Dew points near 20 °C, CAPE about 2,500 J/kg: strong updrafts once storms start.'],N,['ISOLD DMGG WIND GUSTS AND HAIL','Isolated damaging gusts and hail possible.']]};

// ---------- state ----------
const S={step:0,t:0,mode:'tour',playing:!reduce,speed:1,clock:14,clockT:14,run:false,dep:15.5,alt:5500,div:null,tab:'METAR',sel:null,
  lay:{adv:1,radar:1,lag:0,pirep:1,front:1},fb:null};
const L={adv:1,radar:1,lag:0,pirep:1,front:1,out:0,route:1};
// ---------- flight model ----------
function windAt(alt,t){const f=fbAt(t);if(!f)return{d:200,s:12};const I=k=>{const a=f.data.SPI,b=f.data.IND;const ix=clamp((alt-3000)/3000,0,2.999),i=Math.floor(ix),u=ix-i;
  const v=(s,j)=>s[j][k];return((v(a,i)+v(b,i))/2)*(1-u)+((v(a,i+1)+v(b,i+1))/2)*u;};return{d:I(0),s:I(1)};}
function gsFor(alt,t){const w=windAt(alt,t);const a=rad(w.d-CRS);const hw=w.s*Math.cos(a),xw=w.s*Math.sin(a);return{gs:Math.sqrt(TAS*TAS-xw*xw)-hw,hw,w};}
const ALTS={LAF:'LAF',CMI:'CMI',SPI:'SPI'};
function flight(){const g=gsFor(S.alt,S.dep).gs;let pts=[ST.SPI,ST.IND],dest='IND';
  if(S.div&&S.div.t>S.dep){const p=posAlong([ST.SPI,ST.IND],(S.div.t-S.dep)*g);pts=[ST.SPI,...(p.i>0?[ST.IND]:[]),{x:p.x,y:p.y},ST[S.div.to]];pts=[ST.SPI,{x:p.x,y:p.y},ST[S.div.to]];dest=S.div.to;}
  let len=0;for(let i=1;i<pts.length;i++)len+=dist(pts[i-1],pts[i]);return{pts,gs:g,len,eta:S.dep+len/g,dest};}
function posAlong(pts,d){d=Math.max(0,d);for(let i=1;i<pts.length;i++){const l=dist(pts[i-1],pts[i]);if(d<=l){const u=d/l;return{x:pts[i-1].x+(pts[i].x-pts[i-1].x)*u,y:pts[i-1].y+(pts[i].y-pts[i-1].y)*u,i:i-1,h:brg(pts[i-1],pts[i])};}d-=l;}
  const a=pts[pts.length-2],b=pts[pts.length-1];return{x:b.x,y:b.y,i:pts.length-2,h:brg(a,b),end:1};}
function cellDist(p,t){let best=1e9,id='';CELLS.forEach(c=>{const q=cellAt(c,t);if(!q)return;const d=dist(p,q)-q.r;if(d<best){best=d;id=q.id;}});return best;}
function minCellOnFlight(F,tEnd){let m=1e9;for(let t=S.dep;t<=tEnd;t+=1/60){const p=posAlong(F.pts,(t-S.dep)*F.gs);m=Math.min(m,cellDist(p,t));}return m;}
const sigActive=t=>SIGS.filter(s=>s.t<=t&&t<s.end);

// ---------- lesson ----------
const steps=[
{title:'The flight and the clock',dur:15,clock:[13.9,14],tab:'METAR',lay:{adv:0,radar:0,pirep:0,front:0},
 body:'You plan a VFR trip from Springfield, IL (<b>KSPI</b>) to Indianapolis (<b>KIND</b>), 156 NM east, departing <b>1530Z</b>. Every weather product is in UTC, "Z". Springfield is on CDT (Z−5) and Indianapolis on EDT (Z−4), so you leave at 10:30 local and land around 12:47 local. You start your brief at 1400Z.',
 tags:[{at:1,a:'SPI',text:'Departure\nKSPI'},{at:4,a:'IND',text:'Destination\nKIND'}],
 refs:['p91_103','ac91_92','aim715','acsI_C'],more:`<ul>
<li><b>§91.103</b>: before any flight not in the vicinity of an airport, become familiar with all available information, including weather reports and forecasts, fuel requirements and alternatives if the flight cannot be completed as planned.</li>
<li><b>AC 91-92</b>: a self-brief from approved sources is fine, but it must cover what a standard briefing would. The <b>standard briefing</b> order (AIM 7-1-5): adverse conditions, VFR not recommended, synopsis, current conditions, en route forecast, destination forecast, winds aloft, NOTAMs, ATC delays.</li>
<li>UTC also rolls the <b>date</b>: 0100Z on the 15th is 8 PM CDT on the 14th. Day-of-month is in every METAR/TAF time group.</li>
<li>This lab uses a <b>synthetic</b> but internally consistent set of products. For a real flight, use current official sources.</li></ul>`},
{title:'Issue time vs valid time',dur:16,clock:14,tab:'TAF',lay:{adv:1,radar:0,pirep:1,front:0},focus:{p:'T-SPI',toks:['141120Z','1412/1512']},
 body:'Each product has an <b>issue time</b>, and forecasts also have a <b>valid period</b>. The timeline below shows what exists at the clock time (cyan line) against your flight (white band). Observations age by the minute, a TAF covers 24–30 hours, and a winds-aloft forecast is meant for one window only. Products issued after the clock time do not exist yet.',
 refs:['aim712','awh24','awh27','phak13'],more:`<ul>
<li><b>METAR</b>: hourly, usually near :53 for ASOS. <b>SPECI</b>: any time a threshold is crossed.</li>
<li><b>TAF</b>: four times a day (00, 06, 12, 18Z), 24 or 30 h. <b>AMD</b> any time it is wrong.</li>
<li><b>FB</b> winds aloft: from the 00Z and 12Z model runs (and more), each with a "for use" window.</li>
<li><b>AIRMET</b>: every 6 h (0245, 0845, 1445, 2045Z). <b>SIGMET</b>: as needed, up to 4 h. <b>Convective SIGMET</b>: hourly at H+55, valid 2 h.</li>
<li>Datalink weather (FIS-B) carries its own product age, often older than the clock suggests.</li></ul>`},
{title:'Decode the departure METAR',dur:20,clock:14,tab:'METAR',lay:{adv:0,radar:0,pirep:0,front:0},focus:{p:'M-SPI',toks:['141353Z','19006KT','2SM','BR','OVC007','21/20','A2996']},
 body:'At 1353Z Springfield reports 2 SM in mist under an overcast <b>ceiling at 700 ft</b>: <b class="w">IFR</b>. Temperature 21 °C, dew point 20 °C: a 1 °C spread means the air is saturated, which is why there is fog. Each airport on the map is colored by its <b>flight category</b>.',
 tags:[{at:2,a:'SPI',text:'KSPI: IFR\nOVC007, 2 SM'}],
 refs:['aim717','awh24','phak13','p91_155'],more:`<table><tr><th>Category</th><th>Ceiling</th><th>Visibility</th></tr>
<tr><td style="color:#ef7fd1">LIFR</td><td>below 500 ft</td><td>below 1 SM</td></tr><tr><td style="color:#e2574a">IFR</td><td>500 to below 1,000</td><td>1 to below 3 SM</td></tr>
<tr><td style="color:#5b9dff">MVFR</td><td>1,000–3,000</td><td>3–5 SM</td></tr><tr><td style="color:#7fd98a">VFR</td><td>above 3,000</td><td>above 5 SM</td></tr></table>
<ul><li>The <b>ceiling</b> is the lowest broken, overcast or obscured (VV) layer. METAR and TAF heights are <b>AGL</b>; PIREPs, AIRMETs and SIGMETs use <b>MSL</b>.</li>
<li>Within a Class B, C, D or E surface area you need a <span class="k">1,000 ft</span> ceiling and <span class="k">3 SM</span> ground visibility to go VFR without a special VFR clearance (§91.155(c),(d)).</li>
<li>Winds in METARs and TAFs are <b>true</b>; ATIS and tower give magnetic.</li></ul>`},
{title:'SPECI: conditions changed',dur:16,clock:[14,14.55],tab:'METAR',lay:{adv:0,radar:0,pirep:0,front:0},focus:{p:'M-SPI',toks:['SPECI','141424Z','4SM','BKN012']},
 body:'Between hourly reports, a <b>SPECI</b> goes out when conditions cross a set threshold, such as the ceiling rising through 1,000 ft. At 1424Z Springfield improves to <b style="color:var(--mvfr)">MVFR</b>: the morning radiation fog is lifting into low stratus as the sun heats the ground.',
 refs:['aim712','awh18','phak12'],more:`<ul>
<li>SPECI triggers (AIM Table 7-1-1) include: visibility crossing 3, 2 or 1 SM; ceiling forming or crossing 3,000, 1,500, 1,000, 700 or 500 ft; a thunderstorm beginning or ending; a wind shift; a tornado or funnel cloud.</li>
<li><b>Radiation fog</b> needs a clear night, light wind and a small temperature/dew point spread. It burns off from the edges and from below, often lifting into a stratus layer first, just like 1424Z here.</li>
<li>A thin layer with clear air above can still trap you: VFR on top with no way down is a classic accident chain.</li></ul>`},
{title:'Read the TAF',dur:22,clock:14.9,tab:'TAF',lay:{adv:0,radar:0,pirep:0,front:0},focus:{p:'T-SPI',toks:['TEMPO','1412/1414','FM141500','P6SM','SCT025','FM142000','VCTS','SCT050CB']},
 body:'The Springfield TAF calls for IFR with temporary fog until 1500Z, then <b>FROM 1500Z</b> VFR. But at 1453Z the field is still MVFR, so the forecast is running late. Use the newest <b>observation</b> for what is happening now, and the <b>TAF</b> for the trend. FM means a sharp change; TEMPO means short spells.',
 tags:[{at:3,a:'SPI',text:'Forecast VFR 1500Z\nObserved MVFR 1453Z'}],
 refs:['awh27','phak13','aim712'],more:`<ul>
<li><b>FM</b>hhmm: rapid change; the group replaces everything before it. <b>BECMG</b>: gradual change over the period. <b>TEMPO</b>: fluctuations lasting under 1 hour each, adding up to less than half the period. <b>PROB30/40</b>: probability of thunderstorms or precipitation.</li>
<li><b>P6SM</b>: more than 6 SM. <b>VCTS</b>: thunderstorms 5–10 SM from the airport. The only cloud type a TAF forecasts is <b>CB</b>.</li>
<li>A TAF covers 5 SM around the runways. Timing of fog burn-off and of convection is the weakest part of any TAF: plan for an hour or two either way.</li></ul>`},
{title:'AIRMETs: hazards over a wide area',dur:18,clock:[14.6,14.85],tab:'AIRMET',lay:{adv:1,radar:0,pirep:0,front:0},focus:{p:'AT',toks:['MOD TURB BLW 080.']},
 body:'<b style="color:#a99bff">AIRMET Sierra</b> covered IFR in mist and fog over central Illinois until 1500Z. At 1445Z the new issuance drops it. <b class="v">AIRMET Tango</b> stays: moderate turbulence below 8,000 ft all day in the strong southwest flow. AIRMETs target hazards that matter most to light aircraft.',
 refs:['aim716','awh26','phak13'],more:`<ul>
<li><b>Sierra</b>: IFR and mountain obscuration. <b>Tango</b>: moderate turbulence, sustained surface winds over 30 kt, low-level wind shear. <b>Zulu</b>: moderate icing and freezing levels.</li>
<li><b>G-AIRMETs</b> are the graphical version: snapshots every 3 hours, more precise in time and space than the text.</li>
<li><b>SIGMETs</b> (non-convective) cover hazards to all aircraft: severe icing, severe or extreme turbulence, dust or sand storms below 3 SM, volcanic ash. A <b>CWA</b> from the Center Weather Service Unit is a short nowcast, up to 2 hours.</li></ul>`},
{title:'PIREPs: what pilots actually found',dur:20,clock:14.9,tab:'PIREP',lay:{adv:0,radar:0,pirep:1,front:0},focus:{p:'P2',toks:['/FL065','/TB LGT-MOD 040-070','/RM BUILDING CU W OF IND']},
 body:'Pilot reports are the only direct look at tops, turbulence and icing aloft. A Bonanza north of Terre Haute had light-to-moderate turbulence from 4,000 to 7,000 ft and cumulus <b>building</b> west of Indianapolis. That is an early sign of unstable air. <b class="v">Hazard 1: turbulence</b>.',
 tags:[{at:1,a:'P2',text:'PIREP 1440Z\nLGT-MOD turbulence'}],
 refs:['awh24','awh19','aim7'],more:`<ul>
<li>Required fields: /OV location, /TM time, /FL altitude, /TP type, plus at least one weather element. Heights are <b>MSL</b>.</li>
<li><b>Light</b>: slight erratic changes; you feel the belts. <b>Moderate</b>: changes in altitude or attitude, still in positive control, airspeed varies. <b>Severe</b>: large abrupt changes, momentarily out of control. <b>Extreme</b>: practically impossible to control.</li>
<li>Turbulence is reported for the aircraft type: moderate in a Bonanza can feel worse in a 172. Slow to maneuvering speed or below in turbulence.</li>
<li><b>UUA</b> (urgent) is for severe turbulence or icing, hail, low-level wind shear, tornado, volcanic ash. Give PIREPs yourself through Flight Service or ATC.</li></ul>`},
{title:'Winds aloft and cruise altitude',dur:20,clock:14.9,tab:'WINDS',lay:{adv:0,radar:0,pirep:0,front:0},focus:{p:'FB',toks:['2119+16','2117+17','2322+11']},
 body:'The winds-aloft forecast for use 1400–2100Z gives about <b>210° at 18 kt</b>, +16 °C at 6,000 ft. Directions are true, speeds in knots. Flying east above 3,000 ft AGL you cruise at odd thousands plus 500 (§91.159). At 5,500 ft that is a small tailwind: <b class="r" id="gsTxt"></b>.',
 refs:['awh27','p91_159','phak13'],more:`<ul>
<li>Format <span class="k">DDSS±TT</span>: direction in tens of degrees true, speed in knots, temperature °C. <span class="k">9900</span> = light and variable. Speeds 100–199 kt add 50 to the direction (7319 = 230° at 119 kt).</li>
<li>No wind is given within 1,500 ft of the station elevation, and no temperature at 3,000 ft or within 2,500 ft of the station.</li>
<li>+16 °C at 6,000 ft is about ISA +13 °C, so density altitude at cruise is near 7,500 ft: climb rate and true airspeed margins shrink on a hot morning.</li>
<li>Magnetic course 0–179°: odd thousands + 500 ft; 180–359°: even thousands + 500 ft.</li></ul>`},
{title:'Storm risk at the destination',dur:22,clock:14.9,tab:'OUTLOOK',lay:{adv:0,radar:0,pirep:0,front:1,out:1},focus:{p:'OUT',toks:['SLGT RISK','SCT TS DVLPG BY 18-20Z','IN VERY MOIST UNSTABLE AIR']},
 body:'Indianapolis is forecast VFR with a 30% chance of thunderstorms 1900–2300Z. The convective outlook puts central Indiana in a <b>Slight risk</b> ahead of a cold front, in very moist, unstable air. Your 1647Z ETA beats the window by two hours, but convective timing is uncertain. <b class="v">Hazard 2: thunderstorms</b>.',
 tags:[{at:2,a:'IND',text:'TAF: PROB30 TSRA\n1900–2300Z'}],
 refs:['awh27','awh22','phak12','spc'],more:`<ul>
<li>Thunderstorms need <b>moisture</b>, <b>instability</b> and a <b>lifting</b> action (front, terrain, daytime heating).</li>
<li>Life cycle: <b>cumulus</b> (updrafts), <b>mature</b> (rain starts, up- and downdrafts, the most violent stage), <b>dissipating</b> (downdrafts). A single cell lasts under an hour; multicell clusters and lines last for hours.</li>
<li>SPC categories: TSTM, 1 MRGL, 2 SLGT, 3 ENH, 4 MDT, 5 HIGH. A Slight risk means scattered severe storms are possible somewhere in the area.</li>
<li>PROB30 1419/1423 does <b>not</b> mean "no storms before 1900Z". It means the forecaster's best guess.</li></ul>`},
{title:'Decision at 1500Z: go, with an out',dur:20,clock:[14.9,15.05],tab:'TAF',lay:{adv:1,radar:0,pirep:1,front:1},focus:{p:'T-IND',toks:['FM141600','PROB30','1419/1423']},decide:'go',
 body:'VFR at Springfield by departure time, bumpy but VFR en route, Indianapolis VFR before the storm window. A sound call is <b>go at 1530Z</b>, with alternates picked (Lafayette to the north, Champaign behind you), fuel to reach them, and a plan to <b>update weather in flight</b>.',
 refs:['p91_103','p91_151','phak2','ac91_92'],more:`<ul>
<li><b>PAVE</b> checklist: Pilot, Aircraft, enVironment, External pressures. Weather sits in "enVironment"; the pressure to arrive is "External".</li>
<li><b>Personal minimums</b>: written before you look at the weather, e.g. ceiling ≥ 3,000 ft, visibility ≥ 5 SM, gusts ≤ 20 kt, no convective SIGMET within 40 NM.</li>
<li>Day VFR fuel: enough to the first point of intended landing plus <span class="k">30 min</span> at normal cruise (§91.151). Plan more when you may divert.</li>
<li>In-flight sources: Flight Service (122.2, or a published RCO frequency), ATIS/AWOS/ASOS along the route, ATC, and FIS-B datalink.</li></ul>`},
{title:'The picture changes: Convective SIGMET',dur:22,clock:[15.5,15.95],tab:'SIGMET',lay:{adv:1,radar:1,pirep:1,front:1},focus:{p:'C36',toks:['AREA SCT EMBD TS','MOV FROM 23030KT.','TOPS TO FL420.']},
 body:'At 1555Z, 25 minutes into the flight, a <b class="w">Convective SIGMET</b> is issued: scattered, embedded thunderstorms southwest of Indianapolis, moving from 230° at 30 kt, tops to FL420. The storms fired three hours earlier than the TAF said, across your route and toward your destination. <b class="w">Hazard 3: convection</b>.',
 tags:[{at:3,a:'cellA',text:'New storms\nmoving NE 30 kt',color:C.warn},{at:6,a:'plane',text:'You, 25 min out'}],
 refs:['aim716','awh26','awh22','phak13'],more:`<ul>
<li>Convective SIGMETs are issued for lines or areas of thunderstorms with significant coverage, embedded storms, or severe storms (hail ¾ in or more, gusts 50 kt or more, tornadoes). Any Convective SIGMET implies severe turbulence, severe icing and low-level wind shear.</li>
<li>They are numbered by region (E, C, W) and issued hourly at H+55, valid 2 hours. "No Convective SIGMET" does not mean no storms.</li>
<li>Hazards reach well beyond the cell: <b>gust fronts</b> 15–20 NM ahead, hail under the anvil, <b>microbursts</b> with downdrafts up to 6,000 fpm, lightning.</li></ul>`},
{title:'Cockpit radar is old news',dur:18,clock:[15.95,16.15],tab:'PIREP',lay:{adv:1,radar:1,lag:1,pirep:1,front:1},focus:{p:'P3',toks:['UUA','/TB SEV','/RM DEVIATING N AROUND TS LOST 600 FT']},
 body:'Datalink NEXRAD (FIS-B) is a mosaic that can be 5–15 minutes old, and these cells move 30 kt: the image (filled) can trail the real storm (outline) by several miles. Use it to stay far away, never to pick through gaps. An urgent PIREP confirms it: <b class="w">severe turbulence</b> 25 NM southwest of Indianapolis.',
 tags:[{at:2,a:'cellA',text:'Outline = storm now\nFilled = datalink image',color:C.warn}],
 refs:['aim719','awh22','awh19'],more:`<ul>
<li>The time stamp on a FIS-B NEXRAD image is when the mosaic was built; the radar data inside it is older still.</li>
<li>FIS-B weather is for <b>strategic</b> planning, not tactical maneuvering around cells (AIM 7-1-9).</li>
<li>Stay at least <span class="k">20 NM</span> from any thunderstorm identified as severe or giving an intense radar echo; clear the top of a severe storm by at least 1,000 ft for each 10 kt of wind at the cloud top (AWH Ch 22). For a light airplane that means going around, far around, or landing.</li></ul>`},
{title:'Revise the plan: divert',dur:24,clock:[16.0,16.8],tab:'METAR',lay:{adv:1,radar:1,lag:0,pirep:1,front:1},focus:{p:'M-IND',toks:['SPECI','26026G41KT','2SM','+TSRA','BKN025CB','26045/1634']},divert:{t:16.0,to:'LAF'},
 body:'Continuing would put you over Indianapolis just as it reports 2 SM in <b>heavy thunderstorm rain</b>, gusts to 41 kt, peak 45 kt. You divert at 1600Z to <b>Lafayette</b>: VFR, with the storms moving away from it. Landing at Champaign and waiting would also work. Cells like these usually clear within an hour or two.',
 tags:[{at:1,a:'plane',text:'Diverting to KLAF',off:[-70,60]},{at:9,a:'IND',text:'KIND SPECI 1638Z\n+TSRA, G41 kt',color:C.warn,off:[-60,70]}],
 refs:['acsI_C','acsVI_C','aim716','phak2'],more:`<ul>
<li>Decide early: a diversion made 60 NM out is a choice; one made 10 NM out is a scramble.</li>
<li>When you divert: turn first toward the alternate, then work out heading, distance, time and fuel. Tell ATC or Flight Service, and file a PIREP for the next pilot.</li>
<li>ACS PA.I.C asks you to make a competent go/no-go decision and a continue/divert decision, using personal minimums and knowing the limits of in-flight weather resources.</li></ul>`},
{title:'Your turn',dur:0,clock:14,tab:'METAR',lay:{adv:1,radar:1,lag:0,pirep:1,front:1},
 body:'Move the <b>clock</b> to see only what was known at that time. Change the departure time and cruise altitude, open any product and tap a code to decode it, then make the call with the buttons. Try leaving at 1400Z, at 1530Z, or at 1730Z.',
 refs:['acsI_C','p91_103','ac91_92','awc'],more:`<ul>
<li>Leave at <b>1400Z</b>: Springfield is IFR. Leave at <b>1730Z</b>: you arrive in the storm window. Leave at <b>1530Z</b> and keep flying past 1555Z: watch the Convective SIGMET.</li>
<li>Tap an airport on the map to read its latest METAR.</li>
<li>Run the clock while flying to watch storms, products and the aircraft move together.</li></ul>`},
];

// ---------- product list for the current clock ----------
function catCol(c){return C[c]||C.dim;}
function products(tab,t){const out=[];
  if(tab==='METAR')ORDER.forEach(s=>{const o=obsAt(s,t);if(o)out.push({key:'M-'+s,toks:o.toks,head:`<b>K${s}</b> ${ST[s].n}`,age:t-o.t,stale:t-o.t>1.2,cat:o.cat,fresh:o.kind==='SPECI'});});
  if(tab==='TAF')ORDER.forEach(s=>{const f=tafAt(s,t);if(f)out.push({key:'T-'+s,toks:f.toks,head:`<b>K${s}</b> ${ST[s].n}${f.amd?' · AMD':''}`,age:t-f.t,fresh:!!f.amd});
    else if(t>=11.33&&s==='HUF')out.push({key:'T-HUF',toks:null,head:'<b>KHUF</b> Terre Haute',note:'No TAF is issued for this airport. Use the nearest TAFs and the area products.'});});
  if(tab==='PIREP')PIREPS.filter(p=>p.t<=t&&t-p.t<2.5).sort((a,b)=>b.t-a.t).forEach(p=>out.push({key:p.id,toks:p.toks,head:p.urgent?'<b style="color:var(--warn)">URGENT PIREP</b>':'<b>PIREP</b>',age:t-p.t,fresh:!!p.urgent}));
  if(tab==='WINDS'){const f=fbAt(t);if(f)out.push({key:'FB',toks:fbToks(f),head:'<b>FB</b> winds and temperatures aloft',age:t-f.t,stale:t>f.use[1]||t<f.use[0]});}
  if(tab==='AIRMET')ADV.filter(a=>a.t<=t&&t<a.end).forEach(a=>{if(ADV.some(b=>b.type===a.type&&b.t>a.t&&b.t<=t))return;
    out.push({key:'A'+a.type,toks:a.toks,head:a.type==='S'?'<b style="color:#a99bff">AIRMET SIERRA</b>':'<b style="color:var(--var)">AIRMET TANGO</b>',age:t-a.t});});
  if(tab==='SIGMET')sigActive(t).forEach(s=>{if(SIGS.some(b=>b.t>s.t&&b.t<=t))return;out.push({key:s.id,toks:s.toks,head:'<b style="color:var(--warn)">CONVECTIVE SIGMET</b>',age:t-s.t,fresh:1});});
  if(tab==='OUTLOOK'&&t>=OUT.t)out.push({key:'OUT',toks:OUT.toks,head:'<b>Convective outlook</b>',age:t-OUT.t});
  return out;}
const TABS=['METAR','TAF','PIREP','WINDS','AIRMET','SIGMET','OUTLOOK'];
const tabsEl=$('tabs'),plist=$('plist');let plKey='',tokIndex={};
TABS.forEach(n=>{const b=document.createElement('button');b.type='button';b.textContent=n;b.dataset.t=n;b.setAttribute('role','tab');b.onclick=()=>{S.tab=n;S.sel=null;};tabsEl.appendChild(b);});
function renderProducts(){const t=S.clock,list=products(S.tab,t);
  const key=S.tab+'|'+list.map(p=>p.key+(p.toks?p.toks.length+p.toks[0][0]:'')).join(',');
  [...tabsEl.children].forEach(b=>{b.classList.toggle('on',b.dataset.t===S.tab);b.setAttribute('aria-selected',b.dataset.t===S.tab);b.classList.toggle('none',!products(b.dataset.t,t).length);});
  if(key!==plKey){plKey=key;tokIndex={};
    plist.innerHTML=list.length?list.map(p=>`<div class="card${p.fresh?' fresh':''}" data-k="${p.key}"><div class="ch"><span>${p.head}${p.cat?` <span class="pill" style="background:${catCol(p.cat)}">${p.cat}</span>`:''}</span><span class="age" data-k="${p.key}"></span></div>`+
      (p.toks?`<div class="raw">${p.toks.map((x,i)=>x[0]==='\n'?'<br>':`<span class="tk${x[1]?' d':''}" data-id="${p.key}:${i}">${x[0].replace(/</g,'&lt;')}</span>`).join(' ')}</div>`:`<div class="empty">${p.note}</div>`)+'</div>').join('')
      :`<div class="empty">${S.tab==='SIGMET'?'No Convective SIGMET in effect here. That does not mean no storms.':'Nothing issued yet at '+Z(t)+'.'}</div>`;
    list.forEach(p=>p.toks&&p.toks.forEach((x,i)=>tokIndex[p.key+':'+i]=x));}
  list.forEach(p=>{const el=plist.querySelector(`.age[data-k="${p.key}"]`);if(!el||p.age===undefined)return;const m=Math.max(0,Math.round(p.age*60));
    const s=(p.key==='FB'?(p.stale?'outside use window':'in use window'):ageTxt(m));if(el.textContent!==s){el.textContent=s;el.classList.toggle('stale',!!p.stale);}});
  plist.querySelectorAll('.tk.sel').forEach(e=>{if(e.dataset.id!==S.sel)e.classList.remove('sel');});
  const se=S.sel&&plist.querySelector(`.tk[data-id="${S.sel}"]`);
  if(se&&!se.classList.contains('sel')){se.classList.add('sel');const r=se.getBoundingClientRect(),c=plist.getBoundingClientRect();if(r.top<c.top||r.bottom>c.bottom)plist.scrollTop+=r.top-c.top-40;}
  const x=S.sel&&tokIndex[S.sel];const html=x?`<code>${x[0].replace(/</g,'&lt;')}</code>${x[1]}`:'<span class="h">Tap any code in a product to decode it.</span>';
  if($('dec').innerHTML!==html)$('dec').innerHTML=html;}
plist.addEventListener('click',e=>{const tk=e.target.closest('.tk');if(!tk)return;const x=tokIndex[tk.dataset.id];if(!x||!x[1])return;S.sel=tk.dataset.id;S.userSel=true;});

// ---------- UI wiring ----------
const dots=$('dots');
steps.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Step '+(i+1)+': '+s.title);b.onclick=()=>goStep(i);dots.appendChild(b);});
function setLayers(o){Object.assign(S.lay,{adv:0,radar:0,lag:0,pirep:0,front:0},o);syncLay();}
function syncLay(){document.querySelectorAll('#lay .tg').forEach(b=>b.setAttribute('aria-pressed',!!S.lay[b.dataset.l]));}
function goStep(i){i=clamp(i,0,steps.length-1);S.step=i;S.t=0;S.userSel=false;const st=steps[i];S.mode=i===steps.length-1?'explore':'tour';
  $('stepNum').textContent='Step '+(i+1)+' of '+steps.length;$('stepTitle').textContent=st.title;$('stepBody').innerHTML=st.body;
  [...dots.children].forEach((b,k)=>{b.className=k===i?'on':(k<i?'done':'');b.setAttribute('aria-current',k===i?'step':'false');});
  const c=Array.isArray(st.clock)?st.clock:[st.clock,st.clock];S.clockFrom=c[0];S.clockTo=c[1];S.clock=c[0];
  S.dep=15.5;S.alt=5500;S.div=st.divert?null:null;S.run=false;S.tab=st.tab||S.tab;S.sel=null;S.fb=null;
  setLayers(st.lay||{});L.out=st.lay&&st.lay.out?1:0;
  $('explore').hidden=S.mode==='explore';$('next').disabled=i===steps.length-1;$('prev').disabled=i===0;
  if(st.decide)decide(st.decide,true);
  syncCtl();Kit.step(st);
  const g=$('gsTxt');if(g){const x=gsFor(5500,14.9);g.textContent=`groundspeed ${Math.round(x.gs)} kt, ${Math.round(156/x.gs*60)} min en route`;}}
$('prev').onclick=()=>goStep(S.step-1);$('next').onclick=()=>goStep(S.step+1);$('explore').onclick=()=>goStep(steps.length-1);
const playBtn=$('play');function setPlay(v){S.playing=v;playBtn.textContent=v?'Pause':'Play';}
playBtn.onclick=()=>setPlay(!S.playing);
Kit.mount({pause:()=>setPlay(false),sources:['acsI_C','p91_103','p91_151','p91_155','p91_159','aim712','aim715','aim716','aim717','aim719','ac91_92','phak2','phak12','phak13','awh11','awh18','awh19','awh22','awh24','awh26','awh27','acsVI_C','awc','spc']});
const spd=$('speed');spd.oninput=()=>{S.speed=+spd.value;$('speedTxt').textContent=S.speed+'×';};
document.querySelectorAll('#lay .tg').forEach(b=>b.onclick=()=>{S.lay[b.dataset.l]=S.lay[b.dataset.l]?0:1;syncLay();});
const userTouch=()=>{if(S.mode==='tour'){S.mode='explore';setPlay(false);}};
const clk=$('clk'),depIn=$('dep'),altIn=$('alt');
clk.oninput=()=>{userTouch();S.clock=+clk.value;if(S.div&&S.clock<S.div.t)S.div=null;};
depIn.oninput=()=>{userTouch();S.dep=+depIn.value;S.div=null;S.fb=null;};
altIn.onchange=()=>{userTouch();S.alt=+altIn.value;};
$('run').onclick=()=>{userTouch();S.run=!S.run;if(S.run&&S.clock>=19.98)S.clock=11;};
function syncCtl(){if(document.activeElement!==clk)clk.value=S.clock;depIn.value=S.dep;$('depTxt').textContent=Z(S.dep);altIn.value=S.alt;$('run').textContent=S.run?'❚❚ Stop':'▶ Run';}
document.addEventListener('keydown',e=>{if(e.target.closest('input,button,select'))return;
  if(e.key===' '){e.preventDefault();setPlay(!S.playing);}else if(e.key==='ArrowRight')goStep(S.step+1);else if(e.key==='ArrowLeft')goStep(S.step-1);});

// ---------- decisions ----------
function phase(F){return S.clock<S.dep?'pre':(S.clock<F.eta?'air':'done');}
let decKey='';
function renderDecBtns(F){const ph=phase(F);const k=ph+(S.div?S.div.to:'');if(k===decKey)return;decKey=k;
  const B=ph==='pre'?[['go','Go at '+Z(S.dep)],['delay','Delay 1 h'],['cancel','Cancel']]:ph==='air'?(S.div?[]:[['cont','Continue'],['LAF','Divert KLAF'],['CMI','Land KCMI'],['SPI','Return KSPI']]):[];
  $('decBtns').innerHTML=B.map(b=>`<button class="b" type="button" data-d="${b[0]}">${b[1]}</button>`).join('');
  $('decBtns').querySelectorAll('button').forEach(b=>b.onclick=()=>{userTouch();decide(b.dataset.d);});}
function decide(d,auto){const F=flight(),t=S.clock,eta=F.eta;let cls='good',msg='';
  const spi=obsAt('SPI',t),sig=sigActive(t),indT=tafAt('IND',t);
  if(d==='go'){
    if(S.dep<15)[cls,msg]=['bad',`<b>No go at ${Z(S.dep)}.</b> The Springfield TAF keeps IFR with temporary fog until 1500Z${spi?`, and the ${Z(spi.t)} report is ${spi.cat}`:''}. VFR needs a 1,000 ft ceiling and 3 SM to depart (§91.155). Delay.`];
    else if(spi&&spi.cat!=='VFR'&&S.dep-t<.3)[cls,msg]=['warn',`<b>Not yet.</b> The TAF says VFR from 1500Z, but Springfield still reports <b>${spi.cat}</b> at ${Z(spi.t)}. Go when the field actually reports VFR.`];
    else if(sig.length&&S.dep<18.6)[cls,msg]=['bad',`<b>No go.</b> Convective SIGMET ${sig[sig.length-1].id.slice(1)}C covers the route and Indianapolis. Wait for the storms to move off and the SIGMET to expire.`];
    else if(indT&&indT.amd&&eta<18.3)[cls,msg]=['bad','<b>No go.</b> The amended Indianapolis TAF has thunderstorms with heavy rain until 1800Z. Arrive after that or not at all.'];
    else if(eta>=18.5&&S.dep<20)[cls,msg]=['warn',`<b>Risky.</b> ETA ${Z(eta)} lands in or near the PROB30 thunderstorm window (1900–2300Z), with a Slight risk outlook. Leave earlier, or plan to stop short.`];
    else [cls,msg]=['good',`<b>Go at ${Z(S.dep)}, ETA ${Z(eta)}.</b> VFR departure, moderate turbulence below 8,000 ft (AIRMET Tango, PIREP), destination VFR ahead of the storm window. Brief alternates (KLAF, KCMI), carry fuel for them, and update weather in flight: the outlook and building cumulus say storms could come early.`];}
  else if(d==='delay'){S.dep=clamp(S.dep+1,13,19);const e2=flight().eta;
    [cls,msg]=e2>=18.5?['warn',`<b>Delayed to ${Z(S.dep)}.</b> ETA ${Z(e2)} now falls in the forecast thunderstorm window. Delaying fixed the fog but created a storm problem.`]:['good',`<b>Delayed to ${Z(S.dep)}, ETA ${Z(e2)}.</b> Costs time, buys margin. Re-check the weather before you leave.`];}
  else if(d==='cancel')[cls,msg]=sig.length||eta>=18.5?['good','<b>Cancelled.</b> Sound: convection is active or forecast at your arrival time.']:['warn','<b>Cancelled.</b> Always a legitimate choice. This brief supported a VFR flight with a plan, so be clear why you said no: personal minimums, fatigue, or the convective risk.'];
  else if(d==='cont'){const p=posAlong(F.pts,(t-S.dep)*F.gs);
    [cls,msg]=sig.length?['bad',`<b>Don't continue.</b> Convective SIGMET ${sig[sig.length-1].id.slice(1)}C lies across the route and over Indianapolis at your ETA. Keep 20 NM from strong storms: divert or land.`]
      :['good',`<b>Continue, and keep updating.</b> No hazard is reported on the route yet${t>=15.9?' but Terre Haute is reporting CB to its northeast':''}. Check ATIS/AWOS ahead, FIS-B and Flight Service every 15–20 minutes.`];}
  else{S.div={t,to:d};const n=ST[d].n;
    [cls,msg]=d==='LAF'?['good',`<b>Diverting to ${n}.</b> VFR there, and the storms are moving away from it. Tell ATC, then file a PIREP.`]
      :d==='CMI'?['good',`<b>Landing at ${n}.</b> Conservative and safe: wait an hour or two for the cells to move through, then re-brief.`]
      :['good',`<b>Returning to ${n}.</b> Safe, if longest. VFR behind you, the front is still far west.`];
    if(!sig.length&&t<15.9){cls='warn';msg+=' Nothing on the route was reported yet, but the cumulus building ahead was a fair reason.';}}
  S.fb={cls,msg,auto};decKey='';}
let fbKey='';
function renderFb(F){let cls='',msg='';const ph=phase(F);
  if(ph==='done'&&S.clock>=S.dep){const m=minCellOnFlight(F,F.eta);const where=ST[F.dest].n;
    if(m<2)[cls,msg]=['bad',`<b>Landed ${where} ${Z(F.eta)}.</b> You flew through a thunderstorm. Severe turbulence, hail and wind shear there can exceed what a light airplane is built for.`];
    else if(m<20)[cls,msg]=['warn',`<b>Landed ${where} ${Z(F.eta)}.</b> You passed ${Math.round(m)} NM from a thunderstorm. Gust fronts and hail reach 20 NM.`];
    else[cls,msg]=['good',`<b>Landed ${where} ${Z(F.eta)}.</b> Closest thunderstorm ${m>500?'none on your path':Math.round(m)+' NM'}.`];}
  else if(S.fb){cls=S.fb.cls;msg=S.fb.msg;}
  else msg=ph==='pre'?'<span style="color:var(--dim)">Brief, then decide: go, delay or cancel.</span>':'<span style="color:var(--dim)">In flight. Keep checking: continue or divert?</span>';
  const k=cls+msg;if(k===fbKey)return;fbKey=k;$('fb').className=cls;$('fb').innerHTML=msg;}

// ---------- readouts ----------
let roKey='';
function readouts(F){const t=S.clock,g=gsFor(S.alt,S.dep),spi=obsAt('SPI',t),ind=obsAt(F.dest,t),f=tafAt(F.dest,t);
  const ph=phase(F);let rte;
  const sig=sigActive(t),tg=ADV.filter(a=>a.type==='T'&&a.t<=t&&t<a.end).length;
  if(ph==='air'){const p=posAlong(F.pts,(t-S.dep)*F.gs);const cd=cellDist(p,t);rte=(cd<60?`<span style="color:${cd<20?'var(--warn)':'var(--var)'}">storm ${Math.max(0,Math.round(cd))} NM</span> · `:'')+`${Math.round(F.len-(t-S.dep)*F.gs)} NM to K${F.dest}`;}
  else rte=(sig.length?'<span style="color:var(--warn)">Convective SIGMET</span> · ':'')+(tg?'MOD turb below 8,000':'no AIRMET turbulence')+` · wind ${Math.round(g.w.d/10)*10}°/${Math.round(g.w.s)}`;
  let dst='no TAF yet';if(f){const fc=tafCat(f,F.eta);dst=`at ${Z(F.eta)}: ${fc.c||'?'}${fc.o?` + <span style="color:var(--var)">${fc.o[3]}</span>`:''} (TAF ${Z(f.t)})`;}
  if(ind&&ind.cat!=='VFR')dst=`<span style="color:${catCol(ind.cat)}">now ${ind.cat}</span> · `+dst;
  const v=[Z(t)+' <span style="font:400 12px var(--f-mono);color:var(--dim)">'+loc(t)+'</span>',
    `Dep ${Z(S.dep)} · ${Math.round(g.gs)} kt GS · ETA ${Z(F.eta)}${F.dest!=='IND'?' K'+F.dest:''}`,
    spi?`<span style="color:${catCol(spi.cat)}">${spi.cat}</span> · ${spi.kind} ${Z(spi.t)} · ${ageTxt(Math.round((t-spi.t)*60))}`:'—',rte,dst];
  const k=v.join('|')+F.dest;if(k===roKey)return;roKey=k;$('roDstL').textContent='K'+F.dest;['roClock','roPlan','roDep','roRte','roDst'].forEach((id,i)=>$(id).innerHTML=v[i]);}

// ---------- canvas ----------
function setup(id){const cv=$(id);const o={cv,ctx:cv.getContext('2d'),w:0,h:0};
  const fit=()=>{const r=cv.getBoundingClientRect();const d=Math.min(2,window.devicePixelRatio||1);o.w=r.width;o.h=r.height;cv.width=Math.max(1,Math.round(r.width*d));cv.height=Math.max(1,Math.round(r.height*d));o.ctx.setTransform(d,0,0,d,0,0);};
  new ResizeObserver(fit).observe(cv);fit();return o;}
const MAP=setup('map'),TL=setup('tl');
function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function tag(ctx,ax,ay,bx,by,text,col,a,W,H){if(a<=0)return;ctx.save();ctx.globalAlpha=a;ctx.font='500 12px '+FB;
  const lines=text.split('\n');const tw=Math.max(...lines.map(l=>ctx.measureText(l).width));const bw=tw+16,bh=lines.length*15+9;
  let x=clamp(bx-bw/2,4,W-bw-4),y=clamp(by-bh/2,4,H-bh-4);
  ctx.strokeStyle=col;ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(x+bw/2,y+bh/2);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(ax,ay,3,0,TAU);ctx.fillStyle=col;ctx.fill();
  rr(ctx,x,y,bw,bh,6);ctx.fillStyle='rgba(6,12,15,.92)';ctx.fill();ctx.strokeStyle=col;ctx.stroke();
  ctx.fillStyle=C.ink;ctx.textBaseline='top';ctx.textAlign='left';lines.forEach((l,i)=>ctx.fillText(l,x+8,y+5+i*15));ctx.restore();}
const PL=[[0,-1],[.12,-.72],[.12,-.2],[.95,.22],[.95,.4],[.12,.22],[.09,.68],[.4,.88],[.4,1],[0,.92]];
function plane(ctx,x,y,h,s,col){ctx.save();ctx.translate(x,y);ctx.rotate(rad(h));ctx.beginPath();
  PL.forEach(([a,b],i)=>i?ctx.lineTo(a*s,b*s):ctx.moveTo(a*s,b*s));for(let i=PL.length-2;i>0;i--)ctx.lineTo(-PL[i][0]*s,PL[i][1]*s);
  ctx.closePath();ctx.fillStyle=col;ctx.fill();ctx.lineWidth=1.2;ctx.strokeStyle='rgba(0,0,0,.6)';ctx.stroke();ctx.restore();}
let G={s:1,ox:0,oy:0};
const sx=p=>G.ox+p.x*G.s,sy=p=>G.oy+p.y*G.s;
function poly(ctx,ll){ctx.beginPath();ll.forEach(([la,lo],i)=>{const p=P(la,lo);i?ctx.lineTo(sx(p),sy(p)):ctx.moveTo(sx(p),sy(p));});ctx.closePath();}
const BLOBS=[[0,0,1],[.45,.2,.62],[-.38,.28,.58],[.15,-.45,.6],[-.25,-.3,.5]];
function drawCell(ctx,q,mode){const R=q.r*G.s;const X=sx(q),Y=sy(q);
  if(mode==='outline'){ctx.save();ctx.setLineDash([4,3]);ctx.strokeStyle='rgba(226,87,74,.9)';ctx.lineWidth=1.6;BLOBS.forEach(([a,b,k])=>{ctx.beginPath();ctx.arc(X+a*R,Y+b*R,R*k,0,TAU);ctx.stroke();});ctx.restore();return;}
  [['rgba(80,190,90,.42)',1],['rgba(240,210,60,.6)',.62],['rgba(226,70,60,.8)',.34]].forEach(([c,k])=>{ctx.fillStyle=c;BLOBS.forEach(([a,b,m])=>{ctx.beginPath();ctx.arc(X+a*R*.9,Y+b*R*.9,R*m*k,0,TAU);ctx.fill();});});}
function drawMap(F){const{ctx,w,h}=MAP;if(w<10)return;const t=S.clock;
  G.s=Math.min(w/W_NM,h/H_NM);G.ox=(w-W_NM*G.s)/2;G.oy=(h-H_NM*G.s)/2;
  ctx.fillStyle=C.screen;ctx.fillRect(0,0,w,h);
  // lat/lon grid + state line
  ctx.strokeStyle=C.grid;ctx.lineWidth=1;for(let lo=-90;lo<=-86;lo+=.5){const a=P(40.85,lo),b=P(38.95,lo);ctx.beginPath();ctx.moveTo(sx(a),sy(a));ctx.lineTo(sx(b),sy(b));ctx.stroke();}
  for(let la=39;la<=40.8;la+=.5){const a=P(la,-90.35),b=P(la,-85.85);ctx.beginPath();ctx.moveTo(sx(a),sy(a));ctx.lineTo(sx(b),sy(b));ctx.stroke();}
  {const a=P(40.85,-87.53),b=P(38.95,-87.53);ctx.strokeStyle='rgba(150,190,195,.22)';ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(sx(a),sy(a));ctx.lineTo(sx(b),sy(b));ctx.stroke();ctx.setLineDash([]);
   ctx.font='500 10px '+FM;ctx.fillStyle='rgba(142,162,165,.6)';ctx.textBaseline='bottom';ctx.textAlign='right';ctx.fillText('ILLINOIS',sx(a)-6,h-6);ctx.textAlign='left';ctx.fillText('INDIANA',sx(a)+6,h-6);}
  // outlook
  if(L.out>.01&&t>=OUT.t){ctx.save();ctx.globalAlpha=L.out;poly(ctx,OUT.mrgl);ctx.fillStyle='rgba(127,217,138,.07)';ctx.fill();ctx.strokeStyle='rgba(127,217,138,.5)';ctx.stroke();
    poly(ctx,OUT.slgt);ctx.fillStyle='rgba(255,230,90,.1)';ctx.fill();ctx.strokeStyle='rgba(255,230,90,.7)';ctx.stroke();
    ctx.font='600 13px '+FD;ctx.fillStyle='rgba(255,230,90,.9)';ctx.textAlign='left';ctx.textBaseline='top';const p=P(40.55,-87.55);ctx.fillText('SLGT',sx(p)+4,sy(p)+2);
    const q=P(40.9,-89.45);ctx.fillStyle='rgba(127,217,138,.9)';ctx.fillText('MRGL',sx(q)+4,sy(q)+2);ctx.restore();}
  // advisories
  if(L.adv>.01){ctx.save();ctx.globalAlpha=L.adv;
    ADV.forEach(a=>{if(!(a.t<=t&&t<a.end)||!a.poly)return;if(ADV.some(b=>b.type===a.type&&b.t>a.t&&b.t<=t))return;const col=a.type==='S'?C.sierra:C.tango;
      poly(ctx,a.poly);ctx.fillStyle=a.type==='S'?'rgba(169,155,255,.1)':'rgba(255,181,74,.03)';ctx.fill();ctx.setLineDash(a.type==='S'?[7,4]:[2,5]);ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([]);
      ctx.font='500 10.5px '+FM;ctx.fillStyle=col;ctx.textBaseline='top';ctx.textAlign='left';const p=P(a.poly[0][0],a.poly[0][1]);ctx.fillText(a.type==='S'?'AIRMET SIERRA · IFR':'AIRMET TANGO · MOD TURB < 8,000',sx(p)+6,sy(p)+(a.type==='S'?26:28));});
    const sg=sigActive(t).filter(s=>!SIGS.some(b=>b.t>s.t&&b.t<=t));sg.forEach(s=>{poly(ctx,s.poly);ctx.fillStyle='rgba(226,87,74,.1)';ctx.fill();ctx.strokeStyle=C.sig;ctx.lineWidth=2;ctx.stroke();
      const p=P(s.poly[1][0],s.poly[1][1]);ctx.font='600 11px '+FM;ctx.fillStyle=C.sig;ctx.textAlign='right';ctx.textBaseline='top';ctx.fillText(s.id.slice(1)+'C',sx(p)-4,sy(p)+4);});
    ctx.restore();}
  // front
  if(L.front>.01){const pts=[];for(let la=38.9;la<=40.9;la+=.1)pts.push(P(la,frontLon(t,la)));if(sx(pts[0])>-40){ctx.save();ctx.globalAlpha=L.front;ctx.strokeStyle=C.front;ctx.lineWidth=2.5;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(sx(p),sy(p)):ctx.moveTo(sx(p),sy(p)));ctx.stroke();
    ctx.fillStyle=C.front;for(let i=2;i<pts.length-1;i+=4){const a=pts[i],b=pts[i+1];const X=sx(a),Y=sy(a),dx=sx(b)-X,dy=sy(b)-Y,l=Math.hypot(dx,dy)||1;ctx.beginPath();ctx.moveTo(X,Y);ctx.lineTo(X+dx/l*10,Y+dy/l*10);ctx.lineTo(X+dx/l*5+dy/l*8,Y+dy/l*5-dx/l*8);ctx.closePath();ctx.fill();}
    const lp=pts[pts.length-3];ctx.font='500 10.5px '+FM;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('COLD FRONT',Math.max(4,sx(lp)+8),sy(lp));ctx.restore();}}
  // radar
  if(L.radar>.01){ctx.save();ctx.globalAlpha=L.radar;const lag=S.lay.lag?10/60:0;
    CELLS.forEach(c=>{const q=cellAt(c,t-lag);if(q)drawCell(ctx,q,'fill');if(lag){const a=cellAt(c,t);if(a)drawCell(ctx,a,'outline');}});
    if(lag){ctx.font='500 10.5px '+FM;ctx.fillStyle=C.dim;ctx.textAlign='right';ctx.textBaseline='top';ctx.fillText('NEXRAD image '+Z(t-lag)+' (10 min old)',w-8,8);}
    ctx.restore();}
  // route
  ctx.save();ctx.strokeStyle='rgba(228,236,233,.55)';ctx.lineWidth=1.5;ctx.setLineDash([7,5]);ctx.beginPath();ctx.moveTo(sx(ST.SPI),sy(ST.SPI));ctx.lineTo(sx(ST.IND),sy(ST.IND));ctx.stroke();ctx.setLineDash([]);
  const flown=S.clock>S.dep?Math.min(F.len,(S.clock-S.dep)*F.gs):0;
  if(F.dest!=='IND'){ctx.strokeStyle='rgba(92,207,227,.7)';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(sx(F.pts[1]),sy(F.pts[1]));ctx.lineTo(sx(F.pts[2]),sy(F.pts[2]));ctx.stroke();ctx.setLineDash([]);}
  if(flown>0){ctx.strokeStyle=C.ref;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(sx(F.pts[0]),sy(F.pts[0]));let d=flown;
    for(let i=1;i<F.pts.length&&d>0;i++){const l=dist(F.pts[i-1],F.pts[i]);const u=Math.min(1,d/l);ctx.lineTo(sx(F.pts[i-1])+(sx(F.pts[i])-sx(F.pts[i-1]))*u,sy(F.pts[i-1])+(sy(F.pts[i])-sy(F.pts[i-1]))*u);d-=l;}ctx.stroke();}
  ctx.restore();
  // PIREPs
  if(L.pirep>.01)PIREPS.forEach(p=>{if(!(p.t<=t&&t-p.t<2.5))return;const X=sx(p.at),Y=sy(p.at);ctx.save();ctx.globalAlpha=L.pirep;ctx.fillStyle=p.urgent?C.warn:C.ref;ctx.beginPath();ctx.moveTo(X,Y+6);ctx.lineTo(X-6,Y-5);ctx.lineTo(X+6,Y-5);ctx.closePath();ctx.fill();
    ctx.font='500 10px '+FM;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(p.urgent?'UUA':'UA',X+8,Y-1);ctx.restore();});
  // stations
  ORDER.forEach(s=>{const o=obsAt(s,t),X=sx(ST[s]),Y=sy(ST[s]);ctx.beginPath();ctx.arc(X,Y,7,0,TAU);ctx.fillStyle=o?catCol(o.cat):'#2c3f46';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#071014';ctx.stroke();
    ctx.font='600 13px '+FD;ctx.fillStyle=C.ink;ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('K'+s,X,Y+9);});
  // aircraft
  if(S.clock>=S.dep){const p=posAlong(F.pts,flown);plane(ctx,sx(p),sy(p),p.h,10,'#ffffff');}
  else plane(ctx,sx(ST.SPI)-14,sy(ST.SPI)-12,CRS,7,'rgba(255,255,255,.6)');
  // legend
  ctx.font='500 10.5px '+FM;ctx.textAlign='left';ctx.textBaseline='middle';let lx=8;
  ['VFR','MVFR','IFR','LIFR'].forEach(c=>{ctx.fillStyle=catCol(c);ctx.beginPath();ctx.arc(lx+4,14,4,0,TAU);ctx.fill();ctx.fillStyle=C.dim;ctx.fillText(c,lx+11,14);lx+=ctx.measureText(c).width+22;});
  // tags
  const st=steps[S.step];if(S.mode==='tour')(st.tags||[]).forEach(tg=>{const a=clamp((S.t-tg.at)/.6,0,1);if(!a)return;let A;
    if(ST[tg.a])A={x:sx(ST[tg.a]),y:sy(ST[tg.a])};else if(tg.a==='plane'){const p=posAlong(F.pts,flown);A={x:sx(p),y:sy(p)};}
    else if(tg.a.startsWith('cell')){const q=cellAt(CELLS.find(c=>c.id===tg.a.slice(4)),t);if(!q)return;A={x:sx(q),y:sy(q)};}
    else{const pr=PIREPS.find(p=>p.id===tg.a);A={x:sx(pr.at),y:sy(pr.at)};}
    const sc=clamp(w/600,.55,1);const bx=A.x+sc*(tg.off?tg.off[0]:(A.x>w*.6?-90:90)),by=A.y+sc*(tg.off?tg.off[1]:(A.y>h*.5?-58:58));tag(ctx,A.x,A.y,bx,by,tg.text,tg.color||C.ink,a,w,h);});}
function hitMap(e){const r=MAP.cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  for(const s of ORDER)if(Math.hypot(sx(ST[s])-x,sy(ST[s])-y)<16){userTouch();S.tab='METAR';S.sel=null;plKey='';setTimeout(()=>{const c=plist.querySelector(`.card[data-k="M-${s}"]`);if(c)plist.scrollTop=c.offsetTop-plist.offsetTop;},0);return;}
  for(const p of PIREPS)if(p.t<=S.clock&&S.clock-p.t<2.5&&Math.hypot(sx(p.at)-x,sy(p.at)-y)<14){userTouch();S.tab='PIREP';S.sel=p.id+':1';return;}}
MAP.cv.addEventListener('click',hitMap);

// ---------- timeline ----------
function drawTL(F){const{ctx,w,h}=TL;if(w<10)return;const t=S.clock;ctx.fillStyle=C.screen;ctx.fillRect(0,0,w,h);
  const x0=78,x1=w-10,T0=11,T1=20,X=v=>x0+(clamp(v,T0,T1)-T0)/(T1-T0)*(x1-x0),top=20,rh=19;
  ctx.font='500 10px '+FM;ctx.textBaseline='middle';
  for(let k=T0;k<=T1;k++){const x=X(k);ctx.strokeStyle=k%3===0?'rgba(150,190,195,.16)':C.grid;ctx.beginPath();ctx.moveTo(x,top-4);ctx.lineTo(x,h-4);ctx.stroke();
    ctx.fillStyle=C.dim;ctx.textAlign='center';if(w>420||k%2===0)ctx.fillText(String(k).padStart(2,'0')+'Z',x,9);}
  const rows=['KSPI obs','KIND obs','TAF KSPI','TAF KIND','AIRMET','C. SIGMET','Winds FB','Flight'];
  rows.forEach((r,i)=>{ctx.fillStyle=C.dim;ctx.textAlign='left';ctx.fillText(r,6,top+i*rh+rh/2);});
  const bar=(i,a,b,col,al,hgt=8)=>{if(b<=a)return;ctx.globalAlpha=al;ctx.fillStyle=col;ctx.fillRect(X(a),top+i*rh+(rh-hgt)/2,Math.max(1,X(b)-X(a)),hgt);ctx.globalAlpha=1;};
  const mark=(i,v,col)=>{if(v<T0||v>T1)return;const x=X(v),y=top+i*rh+rh/2;ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x+4,y);ctx.lineTo(x,y+6);ctx.lineTo(x-4,y);ctx.closePath();ctx.fill();};
  ['SPI','IND'].forEach((s,i)=>{const o=OBS[s].filter(x=>x.t<=t);o.forEach((x,k)=>{const nx=k+1<o.length?o[k+1].t:t;bar(i,x.t,nx,catCol(x.cat),.85);
    if(x.kind==='SPECI'){ctx.fillStyle=C.ink;ctx.fillRect(X(x.t)-1,top+i*rh+2,2,rh-4);}});});
  [['SPI',2],['IND',3]].forEach(([s,i])=>{TAFS.filter(f=>f.stn===s&&f.t<=t).forEach(f=>{const nxt=TAFS.find(g=>g.stn===s&&g.t>f.t&&g.t<=t);const end=nxt?nxt.t:99;
    f.seg.forEach(sg=>bar(i,Math.max(sg[0],f.t<sg[0]?sg[0]:f.t),Math.min(sg[1],end),catCol(sg[2]),nxt?.18:.45));
    f.ovl.forEach(o=>{const a=X(Math.max(o[0],T0)),b=X(Math.min(o[1],end));if(b<=a)return;ctx.save();ctx.beginPath();ctx.rect(a,top+i*rh+3,b-a,rh-6);ctx.clip();ctx.strokeStyle=catCol(o[2]);ctx.globalAlpha=nxt?.3:.9;ctx.lineWidth=1.5;
      for(let x=a-20;x<b+20;x+=5){ctx.beginPath();ctx.moveTo(x,top+i*rh+rh);ctx.lineTo(x+12,top+i*rh);ctx.stroke();}ctx.restore();});
    mark(i,f.t,C.ink);});});
  ADV.filter(a=>a.t<=t&&a.poly).forEach(a=>{const nxt=ADV.find(b=>b.type===a.type&&b.t>a.t&&b.t<=t);const end=nxt?Math.min(a.end,nxt.t):a.end;bar(4,Math.max(a.t,T0),end,a.type==='S'?C.sierra:C.tango,.7,a.type==='S'?4:4);});
  {const y=top+4*rh;ADV.filter(a=>a.t<=t).forEach(a=>mark(4,a.t,C.ink));
   ctx.globalAlpha=1;}
  SIGS.filter(s=>s.t<=t).forEach(s=>{const nxt=SIGS.find(b=>b.t>s.t&&b.t<=t);bar(5,s.t,nxt?nxt.t:s.end,C.sig,.8);mark(5,s.t,C.ink);});
  FBS.filter(f=>f.t<=t).forEach(f=>{bar(6,f.use[0],f.use[1],'#8ea2a5',.45);mark(6,f.t,C.ink);});
  bar(7,S.dep,F.eta,'#ffffff',.85,10);
  ctx.globalAlpha=.06;ctx.fillStyle='#fff';ctx.fillRect(X(S.dep),top,Math.max(1,X(F.eta)-X(S.dep)),rh*8);ctx.globalAlpha=1;
  // now line
  const xn=X(t);ctx.strokeStyle=C.ref;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(xn,top-2);ctx.lineTo(xn,h-2);ctx.stroke();
  ctx.fillStyle=C.ref;ctx.font='600 10.5px '+FM;ctx.textAlign=xn>x1-40?'right':'left';ctx.fillText(Z(t),xn+(xn>x1-40?-4:4),h-8);
  ctx.globalAlpha=.55;ctx.fillStyle=C.screen;ctx.fillRect(xn+1,top,x1-xn,rh*8-2);ctx.globalAlpha=1;}

// ---------- loop ----------
let prev=performance.now();
function frame(now){const dt=Math.min(.05,(now-prev)/1000);prev=now;const st=steps[S.step];
  if(S.mode==='tour'&&S.playing){S.t+=dt*S.speed;const D=st.dur||1;const u=clamp(S.t/(D*.75),0,1),e=u*u*(3-2*u);S.clock=S.clockFrom+(S.clockTo-S.clockFrom)*e;
    if(st.divert&&!S.div&&S.clock>=st.divert.t)S.div={...st.divert};
    if(st.focus&&!S.userSel){const n=st.focus.toks.length,per=Math.max(2.2,(D-1)/n),k=Math.min(n-1,Math.floor(S.t/per));
      const prod=products(S.tab,S.clock).find(p=>p.key===st.focus.p);if(prod&&prod.toks){const i=prod.toks.findIndex(x=>x[0]===st.focus.toks[k]);if(i>=0)S.sel=st.focus.p+':'+i;}}
    if(st.dur&&S.t>=st.dur)goStep(S.step+1);}
  if(S.mode==='explore'&&S.run){S.clock=Math.min(20,S.clock+dt*S.speed*.1);if(S.clock>=20)S.run=false;}
  const k=1-Math.exp(-dt*3.2);for(const n of['adv','radar','pirep','front'])L[n]+=((S.lay[n]?1:0)-L[n])*k;L.out+=((S.mode==='tour'?(st.lay&&st.lay.out?1:0):(S.tab==='OUTLOOK'?1:0))-L.out)*k;
  const F=flight();
  $('stepBar').style.width=(S.mode==='tour'&&st.dur?clamp(S.t/st.dur,0,1)*100:100)+'%';
  drawMap(F);drawTL(F);renderProducts();readouts(F);renderDecBtns(F);renderFb(F);syncCtl();
  requestAnimationFrame(frame);}
goStep(0);setPlay(S.playing);requestAnimationFrame(frame);
})();

}
