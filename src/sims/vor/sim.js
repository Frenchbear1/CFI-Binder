// @ts-nocheck
// vor sim (from Aviation Interactives, now part of the binder). mount() runs it inside its block on the page:
// `document` here is scoped to that block (see ../runtime.js), and canvas colours follow the reading theme.
import { makeKit } from '../kit.js';
export function mount(root, document) {
const Kit = makeKit(document);

(()=>{
const TAU=Math.PI*2, rad=d=>d*Math.PI/180, deg=r=>r*180/Math.PI;
const w360=d=>((d%360)+360)%360, w180=d=>{d=w360(d);return d>180?d-360:d;};
const frac=x=>x-Math.floor(x), clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const f3=n=>String(Math.round(w360(n))%360).padStart(3,'0');
const fR=n=>{const v=Math.round(w360(n))%360;return v===0?'360':String(v).padStart(3,'0');};
const BASE_PERIOD=4; // seconds per sweep at 1×
const C={screen:'#071014',grid:'rgba(150,190,195,0.09)',grid2:'rgba(150,190,195,0.2)',ink:'#e4ece9',dim:'#8ea2a5',
  ref:'#5ccfe3',var:'#ffb54a',cmp:'#ef7fd1',warn:'#e2574a',planes:['#ffffff','#c3b3ff','#8fe3b5']};
const FD='"Barlow Condensed","Arial Narrow",sans-serif', FB='"IBM Plex Sans",system-ui,sans-serif', FM='"IBM Plex Mono",ui-monospace,monospace';
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

const S={cyc:0,playing:!reduce,speed:1,mode:'tour',step:0,t:0,sel:0,userSel:false,userObs:false,
  obs:0,obsT:0,needle:0,drag:null};
const planes=[0,1,2].map(i=>({i,brg:60,dist:.68,hdg:'outbound',a:0,tb:60,td:.68,ta:0,orbit:0}));
const L={ref:0,var:0,sRef:0,sVar:0,cmp:0,cdi:0,course:0,tofrom:0,radial:1};
const LT={...L};

const steps=[
{title:'A radio lighthouse',dur:12,
 body:'A VOR ground station transmits on a VHF frequency between 108.00 and 117.95 MHz. It cannot tell you which way your nose points. It tells you which <b>radial</b> you are on: your magnetic bearing <i>from</i> the station. It does that with two 30 Hz signals.',
 show:{radial:1},planes:[{brg:60,dist:.68}],obs:0,
 tags:[{at:.5,anchor:'station',text:'VOR ground station\n(chart symbol: hexagon)',pos:[.42,.42]},
       {at:3,anchor:'north',text:'Magnetic north = 000°',pos:[-.62,-.78]},
       {at:6,anchor:'plane0',text:'This aircraft is on\nthe 060 radial'}]},
{title:'Signal 1: the reference phase',dur:13,
 body:'The first signal is a 30 Hz tone, frequency-modulated onto a 9960 Hz subcarrier. It goes out the same in every direction, so every aircraft sees its peaks at the same instant. Think of it as the station\'s <b class="r">clock</b>.',
 show:{ref:1,sRef:1,radial:1},planes:[{brg:60,dist:.68},{brg:200,dist:.5},{brg:310,dist:.8}],
 tags:[{at:1,anchor:'station',text:'Reference: one pulse sent out\nin every direction at once',pos:[.2,.5],color:C.ref},
       {at:5,anchor:'plane1',text:'All three aircraft see\nthe peak together',color:C.ref}]},
{title:'Signal 2: the variable phase',dur:14,
 body:'The second signal comes from a pattern that rotates clockwise 30 times a second (1,800 rpm, done electronically on modern stations). As its strong side sweeps past you, the carrier gets louder, then softer: a 30 Hz <b class="v">amplitude modulation</b>. When that peak reaches you depends on where you are.',
 show:{var:1,sVar:1,radial:1},planes:[{brg:60,dist:.68},{brg:200,dist:.5},{brg:310,dist:.8}],
 tags:[{at:1,anchor:'beam',text:'Strong side of the pattern,\nsweeping clockwise',pos:[.55,-.78],color:C.var},
       {at:6,anchor:'plane0',text:'Peak arrives when\nthe sweep passes you',color:C.var}]},
{title:'Lined up at magnetic north',dur:12,
 body:'The station is set up so both 30 Hz signals peak together at the instant the sweep points to magnetic north. An aircraft due north sees <b class="c">zero phase difference</b>. It is on the 360 radial.',
 show:{ref:1,var:1,sRef:1,sVar:1,cmp:1,radial:1},planes:[{brg:0,dist:.7}],
 tags:[{at:1,anchor:'north',text:'Both signals peak when\nthe sweep points here',pos:[-.66,-.72],color:C.cmp},
       {at:5,anchor:'plane0',text:'Lag 000° = radial 360'}]},
{title:'Phase difference = radial',dur:21,
 body:'Now fly clockwise around the station. The <b class="v">variable</b> peak arrives later and later after the <b class="r">reference</b> peak. A quarter turn east means 90° of lag, so radial 090. Half way round, 180°. The receiver only has to measure this <b class="c">lag</b>.',
 show:{ref:1,var:1,sRef:1,sVar:1,cmp:1,radial:1},planes:[{brg:0,dist:.7,orbit:18,hdg:'tangent'}],
 tags:[{at:2,anchor:'plane0',text:'Farther clockwise means\na later peak, a bigger lag',color:C.cmp}]},
{title:'Every aircraft gets its own answer',dur:13,
 body:'Everyone hears the same two signals, but each aircraft measures a different lag, so each one knows its own radial. Nothing is sent back to the station, which is why one VOR can serve any number of aircraft. The receiver panel switches between the three.',
 show:{ref:1,var:1,sRef:1,sVar:1,cmp:1,radial:1},planes:[{brg:45,dist:.7},{brg:160,dist:.55},{brg:270,dist:.82}],
 tick:t=>{if(!S.userSel)S.sel=Math.floor(t/4.3)%3;},
 tags:[{at:1,anchor:'sel',text:'On the receiver now'}]},
{title:'In the cockpit: OBS and CDI',dur:15,
 body:'Turn the <b>OBS</b> knob to choose a course. The <b>CDI</b> needle shows how far you are from it: full deflection is 10°, and each dot is 2°. The needle points to where the course is, so fly toward it. Here the aircraft sits on radial 006 while the OBS turns.',
 show:{ref:.35,var:.6,sRef:1,sVar:1,cmp:1,cdi:1,course:1,radial:1},planes:[{brg:6,dist:.72}],obs:330,
 tick:t=>{if(!S.userObs){const k=clamp((t-2)/9,0,1);const e=k*k*(3-2*k);S.obsT=w360(330+36*e);}},
 tags:[{at:1,anchor:'course',text:'Selected course',pos:[-.55,-.55]},
       {at:11.5,anchor:'plane0',text:'OBS 006: needle centred,\nyou are on course'}]},
{title:'TO or FROM?',dur:26,
 body:'The flag tells you whether the selected course would take you <b>toward</b> the station or <b>away</b> from it. It depends only on where you are, never on your heading. This aircraft keeps its nose pointed north the whole way round. The flag flips as it crosses the line abeam the station, and right on that line it shows <b style="color:var(--warn)">OFF</b>.',
 show:{var:.5,ref:.25,sRef:1,sVar:1,cmp:1,cdi:1,course:1,tofrom:1,radial:1},planes:[{brg:300,dist:.7,orbit:14,hdg:0}],obs:0,
 tags:[{at:3,anchor:'plane0',text:'Nose stays north,\nflag still changes'}]},
{title:'Your turn',dur:0,
 body:'Drag the aircraft anywhere, turn the OBS, change the sweep speed. Watch the lag on the receiver, the radial, and the needle all follow. Try putting an aircraft on the 180 radial with the OBS on 360 and see what TO, FROM and the needle say.',
 show:{ref:1,var:1,sRef:1,sVar:1,cmp:1,cdi:1,course:1,tofrom:1,radial:1},planes:[{brg:135,dist:.7,hdg:'inbound'},{brg:300,dist:.5,hdg:'inbound'}],obs:315,
 tags:[]}
];

// ---------- references + deep dive (shared kit) ----------
const DEEP=[
{refs:['phak16','aim113','ifh9','acsVI_B'],more:`<ul>
<li><b>VOR</b> = VHF Omni-directional Range, 108.00–117.95 MHz. 108.00–111.95 is shared with ILS localizers: VORs use the <b>even</b> tenths there (108.2, 109.4…), localizers the <b>odd</b> tenths.</li>
<li>VHF is <b>line of sight</b>. Reception range is roughly <span class="k">1.23 × √(altitude AGL in ft)</span> NM: about 39 NM at 1,000 ft, 123 NM at 10,000 ft. Terrain and low altitude block it.</li>
<li>Identify before you use it: listen to the three-letter <b>Morse ident</b> (some stations add a voice ID). No ident, or <span class="k">T-E-S-T</span>, means the station is under maintenance and may be unreliable.</li>
<li>Service volumes (AIM 1-1-8): Terminal <span class="k">25 NM</span>, Low <span class="k">40 NM</span>, High up to <span class="k">130 NM</span> at altitude. Newer VL/VH volumes extend these under the VOR Minimum Operational Network (MON).</li></ul>`},
{refs:['aim113','ifh9','vorWiki'],more:`<ul>
<li>The 30 Hz reference rides as FM on a <span class="k">9,960 Hz</span> subcarrier (±480 Hz deviation), so it never changes with direction.</li>
<li>The receiver strips the subcarrier and recovers a clean 30 Hz sine. That is the timing mark every bearing is measured from.</li>
<li><b>Doppler VOR (DVOR)</b>, now common, swaps the roles: the reference is AM and the variable signal is made by the Doppler shift of an electronically "rotating" ring of antennas. The receiver math is identical and DVORs are far less affected by nearby terrain and buildings.</li></ul>`},
{refs:['aim113','ifh9','vorWiki'],more:`<ul>
<li>A conventional VOR's pattern is a <b>cardioid</b> (limaçon) spun at <span class="k">30 rev/s = 1,800 rpm</span>, producing 30 Hz AM on the carrier.</li>
<li>In this lab one sweep takes seconds, not 33 ms, so you can see it. The phase relationship is the same.</li>
<li>Reflections off terrain or structures distort the received phase: <b>course scalloping</b> (needle wanders) and <b>course bends</b>. Expect them more at low altitude and in mountains.</li></ul>`},
{refs:['phak16','aim113','ifh9'],more:`<ul>
<li>Radials are <b>magnetic</b>, aligned to the magnetic variation at the station when it was last surveyed (its <b>epoch year</b>). Variation drifts, so a station's 360 radial can differ from today's isogonic value by a degree or more until it is re-aligned.</li>
<li>Station declination is published in the Chart Supplement.</li>
<li>Radials point <b>away</b> from the station. A radial is a position line, not a heading.</li></ul>`},
{refs:['aim114','p91_171','phak16'],more:`<ul>
<li>System accuracy is typically within about <span class="k">±1°</span> at the station; the airborne receiver adds its own error.</li>
<li>IFR use requires a VOR check within the preceding <span class="k">30 days</span> (§91.171): VOT <span class="k">±4°</span> (CDI centered on 0 FROM / 180 TO), ground checkpoint <span class="k">±4°</span>, airborne checkpoint <span class="k">±6°</span>, dual-receiver cross-check <span class="k">4°</span> between them. Log date, place, error and sign.</li>
<li>VFR has no check requirement, but the same test is good practice.</li></ul>`},
{refs:['aim113','phak16','ifh9'],more:`<ul>
<li>The VOR is a pure broadcast: the station has no idea you exist, so capacity is unlimited.</li>
<li>Contrast <b>DME</b>: your radio interrogates the ground station, which replies. Distance is <b>slant range</b>, so directly over a DME at 6,000 ft it reads about 1 NM. Slant error is negligible when you are more than 1 NM away for every 1,000 ft of altitude.</li>
<li>Two VOR radials crossing give a <b>fix</b>. A radial plus DME distance gives a fix from one station.</li></ul>`},
{refs:['phak16','ifh9','acsVI_B'],more:`<ul>
<li>Full-scale deflection = <span class="k">10°</span> (some receivers 12°). Each dot ≈ <span class="k">2°</span>.</li>
<li><b>Rule of 60:</b> 1° off course ≈ 1 NM at 60 NM from the station. Full scale at 30 NM is about 5 NM off; at 6 NM only 1 NM. The needle gets more sensitive as you close in.</li>
<li>The CDI shows angular position only. It does <b>not</b> sense heading: set the OBS to roughly your direction of flight so needle and turn agree.</li>
<li>Time to station ≈ <span class="k">(seconds for a bearing change × 60) ÷ degrees changed</span> in minutes, flown 90° to the radial.</li></ul>`},
{refs:['phak16','ifh9','aim113'],more:`<ul>
<li>The flag answers "would flying the selected course take me toward or away from the station?" It ignores heading.</li>
<li><b>Reverse sensing:</b> flying a heading near the reciprocal of the OBS course (e.g. OBS 360 TO while heading 180) makes the needle point the wrong way. Fix it by setting the OBS to match your direction of travel. An <b>HSI</b> rotates the course card with heading, so it never reverse-senses.</li>
<li><b>Station passage</b> shows as a TO→FROM flip. Directly overhead is the <b>cone of confusion</b>: the needle and flag swing erratically.</li></ul>`},
{refs:['phak16','aim113','aim114','ifh9','acsVI_B'],more:`<ul>
<li>Try: OBS 360, aircraft south of the station → <b>TO</b>, needle centred on the 180 radial.</li>
<li>Intercept: turn the OBS to the desired course, note which side the needle is on, turn toward it with a 30°–45° intercept, then lead the roll-out as it comes alive.</li>
<li>ACS PA.VI.B asks you to tune, identify, orient, track and intercept, and to recognize when a navaid is unusable.</li></ul>`},
];
steps.forEach((s,i)=>Object.assign(s,DEEP[i]||{}));

// ---------- canvas setup ----------
function setup(id){const cv=document.getElementById(id);const o={cv,ctx:cv.getContext('2d'),w:0,h:0};
  const fit=()=>{const r=cv.getBoundingClientRect();const d=Math.min(2,window.devicePixelRatio||1);o.w=r.width;o.h=r.height;cv.width=Math.max(1,Math.round(r.width*d));cv.height=Math.max(1,Math.round(r.height*d));o.ctx.setTransform(d,0,0,d,0,0);};
  new ResizeObserver(fit).observe(cv);fit();return o;}
const MAP=setup('map'),SC=setup('scope'),CD=setup('cdi');

// ---------- UI ----------
const $=id=>document.getElementById(id);
const dots=$('dots');
steps.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Step '+(i+1)+': '+s.title);b.onclick=()=>goStep(i,true);dots.appendChild(b);});
function goStep(i,manual){
  i=clamp(i,0,steps.length-1);S.step=i;S.t=0;S.userSel=false;S.userObs=false;S.sel=0;
  const st=steps[i];
  S.mode=(i===steps.length-1)?'explore':'tour';
  $('stepNum').textContent='Step '+(i+1)+' of '+steps.length;
  $('stepTitle').textContent=st.title;$('stepBody').innerHTML=st.body;
  [...dots.children].forEach((b,k)=>{b.className=k===i?'on':(k<i?'done':'');b.setAttribute('aria-current',k===i?'step':'false');});
  for(const k in LT)LT[k]=0;Object.assign(LT,st.show);
  planes.forEach((p,k)=>{const sp=st.planes[k];
    if(sp){p.tb=sp.brg;p.td=sp.dist;p.ta=1;p.orbit=sp.orbit||0;p.hdg=sp.hdg??'outbound';if(p.a<.05){p.brg=p.tb;p.dist=p.td;}}
    else{p.ta=0;p.orbit=0;}});
  if(st.obs!==undefined)S.obsT=st.obs;
  $('explore').hidden=S.mode==='explore';Kit.step(st);
  $('next').disabled=i===steps.length-1;$('prev').disabled=i===0;
}
$('prev').onclick=()=>goStep(S.step-1,true);
$('next').onclick=()=>goStep(S.step+1,true);
$('explore').onclick=()=>goStep(steps.length-1,true);
const playBtn=$('play');
function setPlay(v){S.playing=v;playBtn.textContent=v?'Pause':'Play';}
playBtn.onclick=()=>setPlay(!S.playing);
Kit.mount({pause:()=>setPlay(false),sources:['phak16','aim113','aim114','aim118','ifh9','p91_171','acsVI_B','vorWiki']});
const spd=$('speed');
function spdTxt(){S.speed=+spd.value;$('speedTxt').textContent=S.speed+'×';const per=BASE_PERIOD/S.speed;
  $('slowTxt').textContent='slow motion · 1 sweep = '+per.toFixed(1)+' s (real: 33 ms)';}
spd.oninput=spdTxt;spdTxt();
const obsIn=$('obs');
obsIn.oninput=()=>{S.obsT=+obsIn.value;S.userObs=true;};
document.querySelectorAll('.obs button').forEach(b=>b.onclick=()=>{S.obsT=w360(Math.round(S.obsT)+(+b.dataset.d));S.userObs=true;});
document.addEventListener('keydown',e=>{if(e.target.closest('input,button'))return;
  if(e.key===' '){e.preventDefault();setPlay(!S.playing);}else if(e.key==='ArrowRight')goStep(S.step+1);else if(e.key==='ArrowLeft')goStep(S.step-1);});

// ---------- geometry ----------
function mapGeom(){const w=MAP.w,h=MAP.h;return{cx:w/2,cy:h/2,R:Math.min(w,h)*0.39};}
const pt=(g,b,r)=>[g.cx+r*Math.sin(rad(b)),g.cy-r*Math.cos(rad(b))];
function local(e,cv){const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];}
function hitPlane(x,y){const g=mapGeom();let best=-1,bd=30;
  planes.forEach((p,k)=>{if(p.a<.3)return;const[px,py]=pt(g,p.brg,p.dist*g.R);const d=Math.hypot(px-x,py-y);if(d<bd){bd=d;best=k;}});return best;}
const mcv=MAP.cv;
mcv.addEventListener('touchstart',e=>{const t=e.touches[0];const[x,y]=local(t,mcv);if(hitPlane(x,y)>=0)e.preventDefault();},{passive:false});
mcv.addEventListener('pointerdown',e=>{const[x,y]=local(e,mcv);const k=hitPlane(x,y);if(k<0)return;
  S.sel=k;S.userSel=true;S.drag=k;planes[k].orbit=0;mcv.setPointerCapture(e.pointerId);mcv.style.cursor='grabbing';});
mcv.addEventListener('pointermove',e=>{const[x,y]=local(e,mcv);
  if(S.drag===null){mcv.style.cursor=hitPlane(x,y)>=0?'grab':'default';return;}
  const g=mapGeom(),dx=x-g.cx,dy=y-g.cy,p=planes[S.drag];
  p.brg=p.tb=w360(deg(Math.atan2(dx,-dy)));p.dist=p.td=clamp(Math.hypot(dx,dy)/g.R,.14,1);});
const endDrag=()=>{S.drag=null;mcv.style.cursor='grab';};
mcv.addEventListener('pointerup',endDrag);mcv.addEventListener('pointercancel',endDrag);
// drag on CDI turns OBS
let cdiDrag=null;
CD.cv.addEventListener('pointerdown',e=>{cdiDrag={x:e.clientX,o:S.obsT};CD.cv.setPointerCapture(e.pointerId);});
CD.cv.addEventListener('pointermove',e=>{if(!cdiDrag)return;S.obsT=w360(Math.round(cdiDrag.o-(e.clientX-cdiDrag.x)*0.6));S.userObs=true;});
CD.cv.addEventListener('pointerup',()=>cdiDrag=null);CD.cv.addEventListener('pointercancel',()=>cdiDrag=null);

// ---------- signal logic ----------
function cdiState(brg,obs){const e=w180(brg-obs);let flag,needle;
  if(Math.abs(e)<=90){flag='FROM';needle=-e;}else{flag='TO';needle=w180(e-180);}
  if(Math.abs(Math.abs(e)-90)<3)flag='OFF';
  return{flag,needle};}

// ---------- drawing helpers ----------
function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
const PL=[[0,-1],[.12,-.72],[.12,-.2],[.95,.22],[.95,.4],[.12,.22],[.09,.68],[.4,.88],[.4,1],[0,.92]];
function plane(ctx,x,y,h,s,col){ctx.save();ctx.translate(x,y);ctx.rotate(rad(h));ctx.beginPath();
  PL.forEach(([a,b],i)=>i?ctx.lineTo(a*s,b*s):ctx.moveTo(a*s,b*s));for(let i=PL.length-2;i>0;i--)ctx.lineTo(-PL[i][0]*s,PL[i][1]*s);
  ctx.closePath();ctx.fillStyle=col;ctx.fill();ctx.lineWidth=1.2;ctx.strokeStyle='rgba(0,0,0,.6)';ctx.stroke();ctx.restore();}
function tag(ctx,ax,ay,bx,by,text,col,a,W,H){
  if(a<=0)return;ctx.save();ctx.globalAlpha=a;ctx.font='500 12.5px '+FB;
  const lines=text.split('\n');const tw=Math.max(...lines.map(l=>ctx.measureText(l).width));const bw=tw+18,bh=lines.length*16+10;
  let x=clamp(bx-bw/2,4,W-bw-4),y=clamp(by-bh/2,4,H-bh-4);
  ctx.strokeStyle=col;ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(x+bw/2,y+bh/2);ctx.stroke();ctx.setLineDash([]);
  ctx.beginPath();ctx.arc(ax,ay,3,0,TAU);ctx.fillStyle=col;ctx.fill();
  rr(ctx,x,y,bw,bh,6);ctx.fillStyle='rgba(6,12,15,.92)';ctx.fill();ctx.strokeStyle=col;ctx.stroke();
  ctx.fillStyle=C.ink;ctx.textBaseline='top';ctx.textAlign='left';lines.forEach((l,i)=>ctx.fillText(l,x+9,y+6+i*16));ctx.restore();}

// ---------- MAP ----------
function drawMap(){
  const{ctx,w,h}=MAP;if(w<10)return;const g=mapGeom(),{cx,cy,R}=g;
  ctx.clearRect(0,0,w,h);ctx.fillStyle=C.screen;ctx.fillRect(0,0,w,h);
  const ph=TAU*S.cyc,beam=360*frac(S.cyc);
  // reference: one omnidirectional pulse per cycle. A ring leaves the station at the reference peak and sweeps
  // out to every bearing at once, with a soft trail behind it (like the variable's sweep); it reaches the edge
  // within ~12° of sweep: the real signal travels at the speed of light, so it reaches every aircraft at the moment
  // the sweep passes north (0° of phase). A slower ring would make the reference look late and the phase look wrong.
  if(L.ref>.01){const R1=R*1.05,T1=.035,f0=frac(S.cyc),q=Math.min(1,f0/T1),r=R1*(1-Math.pow(1-q,2));
    const glow=f0<T1?1:Math.max(0,1-(f0-T1)/(1-T1)*1.15);
    if(r>2&&glow>0){const gr=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      gr.addColorStop(0,`rgba(92,207,227,0)`);gr.addColorStop(.55,`rgba(92,207,227,${.05*glow*L.ref})`);gr.addColorStop(1,`rgba(92,207,227,${.3*glow*L.ref})`);
      ctx.fillStyle=gr;ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.fill();}
    if(f0<T1){ctx.strokeStyle=`rgba(92,207,227,${.95*L.ref})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.stroke();}
    ctx.strokeStyle=`rgba(92,207,227,${(.25+.55*glow)*L.ref})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,R1,0,TAU);ctx.stroke();}
  // TO / FROM halves
  if(L.tofrom>.01){const o=S.obs;ctx.save();ctx.globalAlpha=L.tofrom;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,rad(o-90)-Math.PI/2,rad(o+90)-Math.PI/2);ctx.closePath();ctx.fillStyle='rgba(143,227,181,.07)';ctx.fill();
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,rad(o+90)-Math.PI/2,rad(o+270)-Math.PI/2);ctx.closePath();ctx.fillStyle='rgba(195,179,255,.07)';ctx.fill();
    const[a1,b1]=pt(g,o-90,R),[a2,b2]=pt(g,o+90,R);ctx.setLineDash([2,5]);ctx.strokeStyle=C.warn;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(a1,b1);ctx.lineTo(a2,b2);ctx.stroke();ctx.setLineDash([]);
    ctx.font='600 15px '+FD;ctx.textAlign='center';ctx.textBaseline='middle';
    let[x,y]=pt(g,o+28,R*.62);ctx.fillStyle='#8fe3b5';ctx.fillText('FROM SIDE',x,y);
    [x,y]=pt(g,o+180-28,R*.62);ctx.fillStyle='#c3b3ff';ctx.fillText('TO SIDE',x,y);
    [x,y]=pt(g,o+90,R*.86);ctx.fillStyle=C.warn;ctx.font='500 11px '+FM;ctx.fillText('OFF (abeam)',x,y-10);ctx.restore();}
  // rings & spokes
  ctx.strokeStyle=C.grid;ctx.lineWidth=1;[.33,.66].forEach(f=>{ctx.beginPath();ctx.arc(cx,cy,R*f,0,TAU);ctx.stroke();});
  for(let b=0;b<360;b+=30){const[x,y]=pt(g,b,R);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();}
  // variable: rotating limaçon pattern
  if(L.var>.01){ctx.save();ctx.globalAlpha=L.var;
    // 360 spokes, one per degree; brightness follows the rotating pattern strength
    ctx.lineWidth=1.2;
    for(let b=0;b<360;b++){const d=w360(beam-b);const s=Math.max(0,1-d/140);const a=.03+.55*s*s;
      const[x,y]=pt(g,b,R);ctx.strokeStyle=`rgba(255,181,74,${a})`;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();}
    // the pattern maximum
    {const[x,y]=pt(g,beam,R);ctx.strokeStyle=C.var;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();}
    const[tx,ty]=pt(g,beam,R);ctx.save();ctx.translate(tx,ty);ctx.rotate(rad(beam));ctx.fillStyle=C.var;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,2);ctx.lineTo(-6,2);ctx.closePath();ctx.fill();ctx.restore();
    ctx.restore();}
  // compass rose
  ctx.strokeStyle=C.grid2;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(cx,cy,R,0,TAU);ctx.stroke();
  for(let b=0;b<360;b+=5){const L1=b%30===0?11:(b%10===0?7:4);const[x1,y1]=pt(g,b,R),[x2,y2]=pt(g,b,R-L1);ctx.strokeStyle=b%30===0?'rgba(228,236,233,.6)':C.grid2;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  ctx.textAlign='center';ctx.textBaseline='middle';
  for(let b=0;b<360;b+=30){const[x,y]=pt(g,b,R+16);const card={0:'N',90:'E',180:'S',270:'W'}[b];
    ctx.font=card?'700 16px '+FD:'500 11px '+FM;ctx.fillStyle=card?C.ink:C.dim;ctx.fillText(card||f3(b),x,y);}
  ctx.font='500 9.5px '+FM;ctx.fillStyle=C.dim;ctx.fillText('MAG',cx,cy-R-31);
  // course line
  if(L.course>.01){ctx.save();ctx.globalAlpha=L.course;const o=S.obs;const[x1,y1]=pt(g,o,R*1.0),[x2,y2]=pt(g,o+180,R*1.0);
    ctx.strokeStyle='rgba(228,236,233,.75)';ctx.lineWidth=1.6;ctx.setLineDash([8,5]);ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x1,y1);ctx.stroke();ctx.setLineDash([]);
    ctx.save();ctx.translate(x1,y1);ctx.rotate(rad(o));ctx.fillStyle=C.ink;ctx.beginPath();ctx.moveTo(0,-2);ctx.lineTo(7,10);ctx.lineTo(-7,10);ctx.closePath();ctx.fill();ctx.restore();
    const[lx,ly]=pt(g,o-9,R*.9);ctx.font='600 12px '+FM;ctx.fillStyle=C.ink;ctx.fillText('OBS '+fR(o),lx,ly);ctx.restore();}
  // planes
  const fc=frac(S.cyc);
  planes.forEach((p,k)=>{if(p.a<.01)return;const[x,y]=pt(g,p.brg,p.dist*g.R);const col=C.planes[k];ctx.save();ctx.globalAlpha=p.a;
    if(L.radial>.01){ctx.strokeStyle=col;ctx.globalAlpha=p.a*.55*L.radial;ctx.lineWidth=1.2;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(cx,cy);const[ex,ey]=pt(g,p.brg,R);ctx.lineTo(ex,ey);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=p.a;}
    // reference ping (same moment for everybody)
    if(L.ref>.05&&fc<.3){const q=fc/.3;ctx.strokeStyle=`rgba(92,207,227,${(1-q)*L.ref})`;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,10+q*26,0,TAU);ctx.stroke();}
    // variable ping (depends on bearing)
    const vf=frac(S.cyc-p.brg/360);if(L.var>.05&&vf<.3){const q=vf/.3;ctx.strokeStyle=`rgba(255,181,74,${(1-q)*L.var})`;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,10+q*26,0,TAU);ctx.stroke();}
    if(k===S.sel&&planes.filter(q=>q.a>.5).length>1){ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(x,y,17,0,TAU);ctx.stroke();}
    let hd=p.hdg==='outbound'?p.brg:p.hdg==='inbound'?p.brg+180:p.hdg==='tangent'?p.brg+90:p.hdg;
    plane(ctx,x,y,hd,11,col);
    const[lx,ly]=pt(g,p.brg,p.dist*g.R+(p.dist>.8?-30:30));const[ox,oy]=pt(g,p.brg+90,0);
    ctx.font='600 12px '+FM;ctx.fillStyle=col;ctx.textAlign='center';
    const lab='R-'+fR(p.brg);const[sx,sy]=pt({cx:lx,cy:ly},p.brg+90,26);ctx.fillText(lab,sx,sy);
    ctx.restore();});
  // station symbol (VOR hexagon)
  ctx.save();ctx.translate(cx,cy);ctx.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.lineTo(11*Math.cos(a),11*Math.sin(a));}ctx.closePath();
  ctx.fillStyle='#0b171c';ctx.fill();ctx.strokeStyle=C.ink;ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(0,0,2.5,0,TAU);ctx.fillStyle=C.ink;ctx.fill();ctx.restore();
  // legend
  ctx.font='500 11px '+FM;ctx.textAlign='left';ctx.textBaseline='middle';
  [[C.ref,'Reference · omni',L.ref],[C.var,'Variable · rotating',L.var]].forEach(([c,t,a],i)=>{const y=h-14-i*16;ctx.globalAlpha=.3+.7*Math.min(1,a*1.5);
    ctx.fillStyle=c;ctx.fillRect(10,y-4,14,8);ctx.fillStyle=C.ink;ctx.fillText(t,30,y);});ctx.globalAlpha=1;
  // tags
  const st=steps[S.step];const anchor=n=>{
    if(n==='station')return[cx,cy];if(n==='north')return pt(g,0,R);if(n==='beam')return pt(g,beam,R*.7);
    if(n==='course')return pt(g,S.obs,R*.75);const k=n==='sel'?S.sel:+n.slice(5);const p=planes[k];return pt(g,p.brg,p.dist*R);};
  (st.tags||[]).forEach(tg=>{const a=clamp((S.t-tg.at)/.6,0,1);if(!a)return;const[ax,ay]=anchor(tg.anchor);let bx,by;
    if(tg.pos){bx=cx+tg.pos[0]*R;by=cy+tg.pos[1]*R;}else{const k=tg.anchor==='sel'?S.sel:+tg.anchor.slice(5);const p=planes[k];
      const b=p.brg+(p.dist>.6?160:0)+35;[bx,by]=pt({cx:ax,cy:ay},b,R*(p.dist>.6?.42:.36));}
    tag(ctx,ax,ay,bx,by,tg.text,tg.color||C.ink,a,w,h);});
}

// ---------- SCOPE ----------
function drawScope(){
  const{ctx,w,h}=SC;if(w<10)return;ctx.clearRect(0,0,w,h);ctx.fillStyle=C.screen;ctx.fillRect(0,0,w,h);
  const x0=12,x1=w-12,top=6,bot=h-22,rh=(bot-top)/3,W=2.2,c0=S.cyc-W,X=c=>x0+(c-c0)/W*(x1-x0);
  const p=planes[S.sel],th=p.brg,lag=th/360,thr=rad(th);
  // grid every 90° of phase
  ctx.lineWidth=1;for(let k=Math.ceil(c0*4);k<=S.cyc*4;k++){ctx.strokeStyle=k%4===0?C.grid2:C.grid;const x=X(k/4);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bot);ctx.stroke();}
  for(let i=1;i<3;i++){ctx.strokeStyle=C.grid2;ctx.beginPath();ctx.moveTo(x0,top+i*rh);ctx.lineTo(x1,top+i*rh);ctx.stroke();}
  const trace=(f,mid,col,lw,al)=>{ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.globalAlpha=al;ctx.beginPath();for(let x=x0;x<=x1;x+=1){const c=c0+(x-x0)/(x1-x0)*W;const y=mid-f(c);x===x0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();ctx.globalAlpha=1;};
  const label=(i,t,sub,col,al)=>{ctx.globalAlpha=al;ctx.textAlign='left';ctx.textBaseline='top';ctx.font='600 12px '+FM;ctx.fillStyle=col;ctx.fillText(t,x0+2,top+i*rh+5);
    const tw=ctx.measureText(t).width;ctx.font='400 11px '+FM;ctx.fillStyle=C.dim;if(x0+tw+14+ctx.measureText(sub).width<x1)ctx.fillText(sub,x0+tw+12,top+i*rh+6);ctx.globalAlpha=1;};
  const amp=rh*.3;
  // row 1 reference
  const a1=.16+.84*L.sRef,m1=top+rh*.6;
  trace(c=>amp*.85*Math.sin(TAU*11*c+.3*11*Math.sin(TAU*c)),m1,C.ref,1,.42*a1);
  trace(c=>amp*1.05*Math.cos(TAU*c),m1,C.ref,2.4,a1);
  label(0,'REFERENCE','30 Hz FM on 9960 Hz subcarrier',C.ref,a1);
  // row 2 variable
  const a2=.16+.84*L.sVar,m2=top+rh*1.6,env=c=>amp*.62*(1+.55*Math.cos(TAU*c-thr));
  trace(c=>env(c)*Math.sin(TAU*17*c),m2,C.var,1,.42*a2);
  trace(c=>env(c),m2,C.var,2.4,a2);trace(c=>-env(c),m2,C.var,1,.5*a2);
  label(1,'VARIABLE','30 Hz AM',C.var,a2);
  // peak markers
  const mark=(c,y,col,al)=>{const x=X(c);ctx.globalAlpha=al;ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5,y-8);ctx.lineTo(x+5,y-8);ctx.closePath();ctx.fill();ctx.globalAlpha=1;};
  for(let k=Math.ceil(c0);k<=S.cyc;k++)mark(k,m1-amp*1.05-3,C.ref,a1);
  for(let k=Math.ceil(c0-lag);k+lag<=S.cyc;k++)mark(k+lag,m2-amp*.62*1.55-3,C.var,a2);
  // row 3 comparator
  const a3=.16+.84*L.cmp,m3=top+rh*2.62;
  const tr=Math.floor(S.cyc-lag),tv=tr+lag,xr=X(tr),xv=X(tv);
  ctx.globalAlpha=a3;ctx.fillStyle='rgba(239,127,209,.14)';ctx.fillRect(xr,top+rh*2,xv-xr,rh);
  ctx.setLineDash([3,4]);ctx.lineWidth=1.2;ctx.strokeStyle=C.ref;ctx.beginPath();ctx.moveTo(xr,top);ctx.lineTo(xr,bot);ctx.stroke();
  ctx.strokeStyle=C.var;ctx.beginPath();ctx.moveTo(xv,top+rh);ctx.lineTo(xv,bot);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
  trace(c=>amp*.95*Math.cos(TAU*c),m3,C.ref,2,a3);trace(c=>amp*.95*Math.cos(TAU*c-thr),m3,C.var,2,a3);
  label(2,'PHASE DIFFERENCE','',C.cmp,a3);
  ctx.globalAlpha=a3;const yb=top+rh*2+rh*.36;
  if(xv-xr>14){ctx.strokeStyle=C.cmp;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(xr+2,yb);ctx.lineTo(xv-2,yb);ctx.stroke();
    ctx.fillStyle=C.cmp;[[xr+2,1],[xv-2,-1]].forEach(([x,d])=>{ctx.beginPath();ctx.moveTo(x,yb);ctx.lineTo(x+6*d,yb-4);ctx.lineTo(x+6*d,yb+4);ctx.closePath();ctx.fill();});}
  ctx.font='700 22px '+FD;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle=C.cmp;
  const txt=Math.round(w360(th))%360===0?'000° · in phase':f3(th)+'°';const tw=ctx.measureText(txt).width;
  const lx=clamp((xr+xv)/2,x0+tw/2+4,x1-tw/2-4);ctx.fillStyle='rgba(7,16,20,.75)';ctx.fillRect(lx-tw/2-4,yb-26,tw+8,24);ctx.fillStyle=C.cmp;ctx.fillText(txt,lx,yb-3);ctx.globalAlpha=1;
  // axis
  ctx.font='400 10.5px '+FM;ctx.fillStyle=C.dim;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText('◀ earlier',x0,h-10);
  ctx.textAlign='right';ctx.fillText('now',x1,h-10);
}

// ---------- CDI ----------
function drawCDI(cs){
  const{ctx,w,h}=CD;if(w<10)return;ctx.clearRect(0,0,w,h);const cx=w/2,cy=h/2,r=Math.min(w,h)*.47;
  ctx.save();ctx.globalAlpha=.3+.7*L.cdi;
  ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.fillStyle='#1a2428';ctx.fill();
  ctx.beginPath();ctx.arc(cx,cy,r*.94,0,TAU);ctx.fillStyle='#05090b';ctx.fill();
  for(let b=0;b<360;b+=5){const a=rad(b-S.obs)-Math.PI/2,i=b%10===0?r*.78:r*.84;ctx.strokeStyle=b%30===0?C.ink:'rgba(228,236,233,.55)';ctx.lineWidth=b%10===0?1.6:1;
    ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*i,cy+Math.sin(a)*i);ctx.lineTo(cx+Math.cos(a)*r*.91,cy+Math.sin(a)*r*.91);ctx.stroke();}
  ctx.textAlign='center';ctx.textBaseline='middle';
  for(let b=0;b<360;b+=30){const a=rad(b-S.obs)-Math.PI/2;const t={0:'N',90:'E',180:'S',270:'W'}[b]||String(b/10);
    ctx.font=(t.length===1&&isNaN(t)?'700 ':'600 ')+Math.round(r*.15)+'px '+FD;ctx.fillStyle=C.ink;ctx.fillText(t,cx+Math.cos(a)*r*.66,cy+Math.sin(a)*r*.66);}
  // lubber
  ctx.fillStyle=C.var;ctx.beginPath();ctx.moveTo(cx,cy-r*.76);ctx.lineTo(cx-7,cy-r*.93);ctx.lineTo(cx+7,cy-r*.93);ctx.closePath();ctx.fill();
  // dots
  const sp=r*.09;ctx.strokeStyle=C.ink;ctx.lineWidth=1.4;
  for(let i=-5;i<=5;i++){if(!i){ctx.beginPath();ctx.arc(cx,cy,5,0,TAU);ctx.stroke();continue;}ctx.beginPath();ctx.arc(cx+i*sp,cy,2.6,0,TAU);ctx.stroke();}
  // flag
  ctx.font='600 '+Math.round(r*.11)+'px '+FM;
  if(cs.flag==='OFF'){const fw=r*.36,fh=r*.17,fx=cx+r*.14,fy=cy-r*.44;ctx.fillStyle=C.warn;ctx.fillRect(fx,fy,fw,fh);ctx.fillStyle='#fff';ctx.fillText('OFF',fx+fw/2,fy+fh/2+1);}
  else{const up=cs.flag==='TO',fx=cx+r*.34,fy=cy+(up?-1:1)*r*.3,s=r*.09;ctx.fillStyle='#fff';ctx.beginPath();
    if(up){ctx.moveTo(fx,fy-s);ctx.lineTo(fx+s,fy+s*.7);ctx.lineTo(fx-s,fy+s*.7);}else{ctx.moveTo(fx,fy+s);ctx.lineTo(fx+s,fy-s*.7);ctx.lineTo(fx-s,fy-s*.7);}
    ctx.closePath();ctx.fill();ctx.fillText(cs.flag,fx,fy+(up?-1:1)*s*2.1);}
  // needle
  const nx=cx+clamp(S.needle/10,-1,1)*5*sp;ctx.strokeStyle='#fff';ctx.lineWidth=3.2;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(nx,cy-r*.56);ctx.lineTo(nx,cy+r*.56);ctx.stroke();
  // OBS label + knob
  ctx.restore();
}

// ---------- readouts ----------
let last='';
function readouts(cs){const p=planes[S.sel];const n=S.needle;
  let nd=Math.abs(n)<.5?'centred':(Math.abs(n)>=9.9?'full '+(n<0?'left':'right'):(Math.abs(n)/2).toFixed(1).replace('.0','')+' dot'+(Math.abs(n)/2>1?'s':'')+' '+(n<0?'L':'R'));
  let adv;if(cs.flag==='OFF')adv='Abeam the station: TO and FROM are ambiguous, so the flag shows OFF. Do not follow the needle.';
  else if(Math.abs(n)<.5)adv=`On course ${fR(S.obs)} ${cs.flag}. Keep the needle centred.`;
  else adv=`Course ${fR(S.obs)} ${cs.flag} is to your ${n<0?'left':'right'}. Turn ${n<0?'left':'right'} toward the needle.`;
  const s=[fR(p.brg),f3(p.brg),fR(S.obs),cs.flag+' · '+nd,adv].join('|');if(s===last)return;last=s;
  $('roRadial').textContent='R-'+fR(p.brg);$('roLag').textContent=f3(p.brg)+'°';$('roObs').textContent=fR(S.obs);
  $('roFlag').textContent=cs.flag+' · '+nd;$('roFlag').style.color=cs.flag==='OFF'?'var(--warn)':'';$('advice').textContent=adv;
  if(document.activeElement!==obsIn)obsIn.value=Math.round(w360(S.obsT))%360;}

// ---------- loop ----------
let prev=performance.now();
function frame(now){const dt=Math.min(.05,(now-prev)/1000);prev=now;const st=steps[S.step];
  if(S.playing){S.cyc+=dt*S.speed/BASE_PERIOD;S.t+=dt;if(st.tick)st.tick(S.t);
    planes.forEach(p=>{if(p.orbit&&S.drag!==p.i)p.tb=w360(p.tb+p.orbit*dt);});
    if(S.mode==='tour'&&st.dur&&S.t>=st.dur)goStep(S.step+1);}
  const k=1-Math.exp(-dt*3.2),k2=1-Math.exp(-dt*5);
  for(const n in L)L[n]+=(LT[n]-L[n])*k;
  planes.forEach(p=>{p.a+=(p.ta-p.a)*k;if(S.drag===p.i)return;p.brg=w360(p.brg+w180(p.tb-p.brg)*(p.orbit?.9:k2));p.dist+=(p.td-p.dist)*k2;});
  S.obs=w360(S.obs+w180(S.obsT-S.obs)*k2);
  if(planes[S.sel].ta<.5)S.sel=0;
  const cs=cdiState(planes[S.sel].brg,S.obs);
  S.needle+=(clamp(cs.needle,-12,12)-S.needle)*(1-Math.exp(-dt*4));
  $('stepBar').style.width=(st.dur?clamp(S.t/st.dur,0,1)*100:100)+'%';
  drawMap();drawScope();drawCDI(cs);readouts(cs);
  requestAnimationFrame(frame);}
goStep(0);setPlay(S.playing);requestAnimationFrame(frame);
})();

}
