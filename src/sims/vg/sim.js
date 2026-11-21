// @ts-nocheck
// vg sim (from Aviation Interactives, now part of the binder). mount() runs it inside its block on the page:
// `document` here is scoped to that block (see ../runtime.js), and canvas colours follow the reading theme.
import { makeKit } from '../kit.js';
export function mount(root, document) {
const Kit = makeKit(document);

"use strict";
const $=id=>document.getElementById(id);
const D2R=Math.PI/180, G0=32.174, KT=1.68781, RHO0=0.0023769;

/* ================= Data =================
   PA-28-181 (Archer) figures from the original trainer: VS1 50, VSO 45, VO 113 KIAS @2550 lb / 98 @1917 lb,
   VFE 102, VNO 125, VNE 154 KIAS, +3.8 G normal category; wing 170 ft², span 35 ft.
   C172S from its POH: VS1 48, VSO 40, VA 105 @2550 (98 @2200), VFE 85, VNO 129, VNE 163.
   Negative limits = 0.4 × positive (old 14 CFR 23.337(b)). Flaps-extended limit +2.0 G (old 23.345). */
const PRESETS={
  pa28n:{name:'PA-28-181 · Normal',maxW:2550,minW:1917,vs1:50,vso:45,va:113,vfe:102,vno:125,vne:154,pos:3.8,neg:-1.52,flapG:2.0,S:170,b:35},
  pa28u:{name:'PA-28-181 · Utility',maxW:2130,minW:1917,vs1:46,vso:41,va:103,vfe:102,vno:125,vne:154,pos:4.4,neg:-1.76,flapG:2.0,S:170,b:35},
  c172n:{name:'C172S · Normal',maxW:2550,minW:1900,vs1:48,vso:40,va:105,vfe:85,vno:129,vne:163,pos:3.8,neg:-1.52,flapG:2.0,S:174,b:36.1},
  c172u:{name:'C172S · Utility',maxW:2200,minW:1900,vs1:45,vso:37,va:98,vfe:85,vno:129,vne:163,pos:4.4,neg:-1.76,flapG:2.0,S:174,b:36.1},
};
const FIELDS=[
  ['h','Weight'],['maxW','Max weight','lb'],['minW','Min weight','lb'],
  ['h','Speeds (KIAS, max weight)'],['vs1','VS1 clean stall'],['vso','VSO flaps stall'],['va','VA maneuvering'],['vfe','VFE flaps'],['vno','VNO max structural'],['vne','VNE never exceed'],
  ['h','Load limits (G)'],['pos','Positive limit'],['neg','Negative limit'],['flapG','Flaps-down limit'],
  ['h','Wing (gust lines)'],['S','Wing area','ft²'],['b','Wingspan','ft'],
];
const KNEG=0.55; // inverted CLmax as a fraction of upright CLmax (typical cambered section; model assumption)

let userKey='pa28n',userLim={...PRESETS.pa28n};
try{const s=JSON.parse(localStorage.getItem('vg.lim')||'null');if(s&&s.lim&&valid(s.lim)){userKey=s.key in PRESETS||s.key==='custom'?s.key:'custom';userLim={...PRESETS.pa28n,...s.lim};}}catch(e){}
function saveLim(){try{localStorage.setItem('vg.lim',JSON.stringify({key:userKey,lim:userLim}));}catch(e){}}
function valid(l){const f=k=>Number.isFinite(l[k]);if(!FIELDS.every(x=>x[0]==='h'||f(x[0])))return false;
  return l.maxW>l.minW&&l.minW>0&&l.vso>0&&l.vso<=l.vs1&&l.vs1<l.vno&&l.vno<l.vne&&l.va>l.vs1&&l.va<=l.vne&&l.vfe>l.vso&&l.vfe<=l.vne&&l.pos>1&&l.pos<=12&&l.neg<0&&l.neg>-8&&l.flapG>=1&&l.flapG<=l.pos&&l.S>20&&l.b>5&&l.vne<=400;}

/* ================= Model ================= */
const S={V:100,bank:0,n:1,W:2550,flaps:false,gust:false,lim:PRESETS.pa28n,hl:[]};   // displayed (eased)
const T={V:100,bank:0,n:1,W:2550};                                                     // targets
function derive(V,n,W,lim,flaps){
  const r=Math.sqrt(W/lim.maxW),vs=lim.vs1*r,vso=lim.vso*r,vsC=flaps?vso:vs;
  const pos=flaps?lim.flapG:lim.pos,neg=flaps?0:lim.neg;
  const WS=W/lim.S,c=lim.S/lim.b,AR=lim.b*lim.b/lim.S,a=0.9*2*Math.PI*AR/(AR+2),mu=2*WS/(RHO0*c*a*G0),Kg=0.88*mu/(5.3+mu);
  return{vs,vso,vsC,vaW:lim.va*r,corner:vs*Math.sqrt(lim.pos),pos,neg,Vd:lim.vne/0.9,
    dn:(v,U)=>Kg*U*v*a/(498*WS),vsN:n>0?vsC*Math.sqrt(n):vsC*Math.sqrt(-n/KNEG)};
}
function status(V,n,d){
  const lim=S.lim;
  if(n>0.05&&V<d.vsC*Math.sqrt(n))return['r',n>1.08?'ACCELERATED STALL':'STALL'];
  if(n<-0.05&&V<d.vsC*Math.sqrt(-n/KNEG))return['r','INVERTED STALL'];
  if(n>lim.pos*1.5||n<lim.neg*1.5)return['r','PAST ULTIMATE LOAD'];
  if(n>lim.pos+1e-3||n<lim.neg-1e-3)return['r','OVER LIMIT LOAD'];
  if(V>lim.vne+0.5)return['r','ABOVE VNE'];
  if(S.flaps&&V>lim.vfe+0.5)return['r','FLAPS · ABOVE VFE'];
  if(S.flaps&&(n>lim.flapG+1e-3||n<-1e-3))return['r','FLAPS LIMIT '+(n<0?'0':'+'+lim.flapG.toFixed(1))+' G'];
  if(V>lim.vno+0.5)return['a','CAUTION · SMOOTH AIR ONLY'];
  if(V>d.vaW+0.5&&Math.abs(n-1)>0.05)return['a','ABOVE VA · NO FULL INPUTS'];
  return null;
}

/* ================= Rear view (forces) ================= */
const NS='http://www.w3.org/2000/svg';
let SC=null,staticKey='';
const fv=$('fv');
fv.innerHTML=`
<defs><clipPath id="mcClip"><rect x="14" y="12" width="104" height="70"/></clipPath>
  <clipPath id="cmpClip"><rect x="146" y="8" width="238" height="30"/></clipPath>
  <linearGradient id="hazeG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d343d" stop-opacity=".9"/><stop offset="1" stop-color="#1d343d" stop-opacity="0"/></linearGradient>
  <linearGradient id="skyG" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1a2f37"/><stop offset=".5" stop-color="#0d181d"/><stop offset="1" stop-color="#091115"/></linearGradient></defs>
<g id="world">
  <rect id="skyR" x="-300" width="1000" fill="url(#skyG)"/>
  <rect id="gndR" x="-300" width="1000" height="1400" fill="#12160f"/>
  <path id="wF0" fill="#1a2316"/><path id="wF1" fill="#211f15"/><path id="wF2" fill="#16211b"/><path id="wLk" fill="#10232c"/>
  <path id="wRd" fill="none" stroke="#3f4734" stroke-width="1"/>
  <rect id="hazeR" x="-300" width="1000" height="36" fill="url(#hazeG)"/>
  <g id="wCl" fill="#cfe0dd"></g>
  <line id="hzL" x1="-300" x2="700" stroke="#4d6a73" stroke-width="1.3"/>
  <text id="hzT" x="8" class="tk">HORIZON</text>
</g>
<g id="mc">
  <rect x="14" y="12" width="104" height="70" rx="4" fill="#0c1418" stroke="#1f2f36"/>
  <path id="mcLim" d="" stroke="#e2574a" stroke-dasharray="3 3" stroke-width="1" fill="none"/>
  <path id="mcCurve" d="" stroke="#5ccfe3" stroke-width="1.6" fill="none" clip-path="url(#mcClip)"/>
  <circle id="mcDot" r="3.2" fill="#e4ece9"/>
  <text x="20" y="25" class="tk">n</text><text x="112" y="77" class="tk" text-anchor="end">bank</text>
</g>
<g id="pv">
  <clipPath id="pvClip"><rect x="14" y="88" width="104" height="70"/></clipPath>
  <rect x="14" y="88" width="104" height="70" rx="4" fill="#0c1418" stroke="#1f2f36"/>
  <g clip-path="url(#pvClip)">
    <line id="pvH" x1="14" x2="118" stroke="#4d6a73" stroke-dasharray="3 3"/>
    <g id="pvA"><path d="M-30 0 L22 -3 Q30 -2 31 0 Q30 2 22 3 L-24 3 Z M-30 0 L-34 -12 L-27 -12 L-22 -1 Z M-4 -1 L6 -1 L4 1.5 L-6 1.5 Z" fill="#1b2a30" stroke="#cfe0dd" stroke-width="1.1" stroke-linejoin="round"/>
      <line x1="31" y1="0" x2="44" y2="0" stroke="#cfe0dd" stroke-opacity=".5" stroke-dasharray="2 2"/></g>
    <line id="pvV" stroke="#7fd98a" stroke-width="1.6"/>
  </g>
  <text id="pvT" x="20" y="100" class="tk"></text><text id="pvT2" x="112" y="153" class="tk" text-anchor="end"></text>
</g>
<g id="cmp">
  <rect x="146" y="8" width="238" height="30" rx="4" fill="#0c1418" fill-opacity=".85" stroke="#1f2f36"/>
  <g id="cmpT" clip-path="url(#cmpClip)"></g>
  <path d="M265 38 l-5 6 h10 z" fill="#ffb54a"/>
  <rect x="244" y="44" width="42" height="15" rx="3" fill="#0c1418" stroke="#ffb54a" stroke-opacity=".6"/><text id="cmpH" x="265" y="55" class="ml" fill="#ffb54a" text-anchor="middle">360°</text>
</g>
<g id="plane" transform="translate(200 190) scale(.8)">
  <g id="stab"><path d="M-58 -10 L58 -10 L58 -6 L-58 -6 Z" fill="#1b2a30" stroke="#cfe0dd" stroke-width="1.2"/></g>
  <g id="wR"><path id="fR" fill="#26363d" stroke="#cfe0dd" stroke-width="1"/><path class="wing" d="M16 10 L150 -3 Q154 -1 150 3 L16 17 Z" fill="#1b2a30" stroke="#cfe0dd" stroke-width="1.4" stroke-linejoin="round"/></g>
  <g id="wL"><path id="fL" fill="#26363d" stroke="#cfe0dd" stroke-width="1"/><path class="wing" d="M-16 10 L-150 -3 Q-154 -1 -150 3 L-16 17 Z" fill="#1b2a30" stroke="#cfe0dd" stroke-width="1.4" stroke-linejoin="round"/></g>
  <path d="M-3.5 -20 L-1.6 -64 L1.6 -64 L3.5 -20 Z" fill="#1b2a30" stroke="#cfe0dd" stroke-width="1.2" stroke-linejoin="round"/>
  <rect x="-17" y="-22" width="34" height="40" rx="13" fill="#1b2a30" stroke="#cfe0dd" stroke-width="1.6"/>
  <path d="M0 18 L0 28" stroke="#8ea2a5" stroke-width="2"/>
  <rect x="-4" y="28" width="8" height="13" rx="3" fill="#0a1014" stroke="#8ea2a5" stroke-width="1.4"/>
  <g id="gR"><path d="M52 13 L54 27" stroke="#8ea2a5" stroke-width="2"/><rect x="50" y="26" width="8" height="15" rx="3" fill="#0a1014" stroke="#8ea2a5" stroke-width="1.4"/></g>
  <g id="gL"><path d="M-52 13 L-54 27" stroke="#8ea2a5" stroke-width="2"/><rect x="-58" y="26" width="8" height="15" rx="3" fill="#0a1014" stroke="#8ea2a5" stroke-width="1.4"/></g>
</g>
<path id="arc" d="" fill="none" stroke="#a99bff" stroke-width="1.6"/>
<text id="arcT" class="ml" fill="#a99bff"></text>
<g id="vecs"></g>`;
function mkArrow(color,w,dash){const g=document.createElementNS(NS,'g');g.innerHTML=`<line stroke="${color}" stroke-width="${w}" stroke-linecap="round" ${dash?'stroke-dasharray="5 4"':''}/><path fill="${color}"/><text class="ml" fill="${color}"></text>`;$('vecs').appendChild(g);return g;}
const AR_={vert:mkArrow('#5ccfe3',2,1),hor:mkArrow('#ffb54a',2,1),wt:mkArrow('#e2574a',3),lift:mkArrow('#5ccfe3',3.4)};
function setArrow(g,x1,y1,x2,y2,label,lx,ly,anchor){
  const L=Math.hypot(x2-x1,y2-y1),[ln,hd,tx]=g.children;
  if(L<5){g.style.display='none';return;}g.style.display='';
  const ux=(x2-x1)/L,uy=(y2-y1)/L,h=Math.min(10,L*0.45),bx=x2-ux*h,by=y2-uy*h;
  ln.setAttribute('x1',x1);ln.setAttribute('y1',y1);ln.setAttribute('x2',bx);ln.setAttribute('y2',by);
  hd.setAttribute('d',`M${x2} ${y2} L${bx-uy*h*0.5} ${by+ux*h*0.5} L${bx+uy*h*0.5} ${by-ux*h*0.5}Z`);
  tx.textContent=label;tx.setAttribute('x',lx);tx.setAttribute('y',ly);tx.setAttribute('text-anchor',anchor||'start');}
const MC={x:14,y:12,w:104,h:70,b1:80,n0:1,n1:5};
const mcX=b=>MC.x+b/MC.b1*MC.w,mcY=n=>MC.y+MC.h-(n-MC.n0)/(MC.n1-MC.n0)*MC.h;
{let d='';for(let b=0;b<=80;b+=1)d+=(b?'L':'M')+mcX(b).toFixed(1)+' '+mcY(1/Math.cos(b*D2R)).toFixed(1);$('mcCurve').setAttribute('d',d);}
/* Moving world: a 3D chase view. The camera rides behind the airplane, level in roll, looking along the flight path.
   Ground fields, roads and clouds are real points in space, so a descent tilts the view down (horizon rises, ground grows),
   and a turn swings the scene around while the compass tape counts the heading. Frozen while paused. */
const E={x:0,y:0,h:3000,psi:0,vs:0,gam:0,th:0.08,aoa:4.8,kick:0},FOC=260,CX=200,CY=190,NEAR=150;
const hash=(i,j)=>{let h=(i*374761393+j*668265263)|0;h=(h^(h>>>13))*1274126177|0;return((h^(h>>>16))>>>0)/4294967296;};
let cwk=0,swk=0,cgm=1,sgm=0;
function camPt(px,py,pz){const dx=px-E.x,dy=py-E.y,u=pz-E.h,r=dx*cwk-dy*swk,a=dx*swk+dy*cwk;return[r,a*cgm+u*sgm,u*cgm-a*sgm];}
const prj=c=>[CX+FOC*c[0]/c[1],CY-FOC*c[2]/c[1]];
function clipPoly(P){const out=[];for(let i=0;i<P.length;i++){const A=P[i],B=P[(i+1)%P.length],ia=A[1]>NEAR,ib=B[1]>NEAR;
  if(ia)out.push(A);if(ia!==ib){const t=(NEAR-A[1])/(B[1]-A[1]);out.push([A[0]+(B[0]-A[0])*t,NEAR,A[2]+(B[2]-A[2])*t]);}}return out;}
function polyD(P){const c=clipPoly(P);if(c.length<3)return'';return c.map((q,i)=>{const s=prj(q);return(i?'L':'M')+s[0].toFixed(1)+' '+s[1].toFixed(1);}).join('')+'Z';}
function segD(A,B){if(A[1]<=NEAR&&B[1]<=NEAR)return'';if(A[1]<=NEAR){const t=(NEAR-A[1])/(B[1]-A[1]);A=[A[0]+(B[0]-A[0])*t,NEAR,A[2]+(B[2]-A[2])*t];}
  else if(B[1]<=NEAR){const t=(NEAR-B[1])/(A[1]-B[1]);B=[B[0]+(A[0]-B[0])*t,NEAR,B[2]+(A[2]-B[2])*t];}const a=prj(A),b=prj(B);return`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;}
const CELL=3000,RNG=27000,CCELL=9000;
const clEls=Array.from({length:48},()=>{const e=document.createElementNS(NS,'ellipse');$('wCl').appendChild(e);return e;});
const cmpT=$('cmpT');
function drawWorld(){
  cwk=Math.cos(E.psi);swk=Math.sin(E.psi);cgm=Math.cos(E.th);sgm=Math.sin(E.th);
  const hy=CY+FOC*Math.tan(E.th);   // camera looks along the nose: horizon rises when the nose drops
  $('skyR').setAttribute('y',hy-1400);$('skyR').setAttribute('height',1400);$('gndR').setAttribute('y',hy);$('hazeR').setAttribute('y',hy);
  $('hzL').setAttribute('y1',hy);$('hzL').setAttribute('y2',hy);$('hzT').setAttribute('y',hy-6);
  const F=['','',''];let lk='',rd='';const i0=Math.floor(E.x/CELL),j0=Math.floor(E.y/CELL),N=Math.ceil(RNG/CELL);
  for(let i=i0-N;i<=i0+N;i++)for(let j=j0-N;j<=j0+N;j++){
    const x0=i*CELL,y0=j*CELL,cx=x0+CELL/2,cy=y0+CELL/2,dx=cx-E.x,dy=cy-E.y;if(dx*dx+dy*dy>RNG*RNG)continue;
    if(dx*swk+dy*cwk<-CELL)continue;const hv=hash(i,j),k=Math.floor(hv*5);
    if(k<3){const m=200;F[k]+=polyD([[x0+m,y0+m,0],[x0+CELL-m,y0+m,0],[x0+CELL-m,y0+CELL-m,0],[x0+m,y0+CELL-m,0]].map(q=>camPt(...q)));}
    else if(hv>0.93){const P=[];for(let t=0;t<10;t++){const a=t/10*2*Math.PI;P.push(camPt(cx+Math.cos(a)*1100,cy+Math.sin(a)*700,0));}lk+=polyD(P);}
  }
  for(let i=i0-N;i<=i0+N;i+=2){rd+=segD(camPt(i*CELL,E.y-RNG,0),camPt(i*CELL,E.y+RNG,0));}
  for(let j=j0-N;j<=j0+N;j+=2){rd+=segD(camPt(E.x-RNG,j*CELL,0),camPt(E.x+RNG,j*CELL,0));}
  $('wF0').setAttribute('d',F[0]);$('wF1').setAttribute('d',F[1]);$('wF2').setAttribute('d',F[2]);$('wLk').setAttribute('d',lk);$('wRd').setAttribute('d',rd);
  // clouds
  const C=[],ci0=Math.floor(E.x/CCELL),cj0=Math.floor(E.y/CCELL),CN=4;
  for(let i=ci0-CN;i<=ci0+CN;i++)for(let j=cj0-CN;j<=cj0+CN;j++){const hv=hash(i+911,j-377);if(hv<0.45)continue;
    const px=i*CCELL+hash(i,j+5)*CCELL,py=j*CCELL+hash(i+3,j)*CCELL,pz=4200+hash(j,i)*2600,c=camPt(px,py,pz);if(c[1]<2500||c[1]>36000||Math.abs(c[2])>c[1]*0.3)continue;C.push([c,1200+hv*1400]);}
  C.sort((a,b)=>b[0][1]-a[0][1]);
  clEls.forEach((e,k)=>{const q=C[k];if(!q){e.setAttribute('rx',0);return;}const s=prj(q[0]),rx=Math.min(110,FOC*q[1]/q[0][1]);
    e.setAttribute('cx',s[0].toFixed(1));e.setAttribute('cy',s[1].toFixed(1));e.setAttribute('rx',rx.toFixed(1));e.setAttribute('ry',(rx*0.3).toFixed(1));
    e.setAttribute('fill-opacity',(0.2*(1-q[0][1]/36000)).toFixed(3));});
  // compass tape
  const hd=((E.psi/D2R)%360+360)%360;let t='';
  for(let d=Math.ceil((hd-60)/5)*5;d<=hd+60;d+=5){const x=265+(d-hd)*2.1,dd=((d%360)+360)%360,maj=dd%30===0;
    t+=`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${maj?28:32}" y2="38" stroke="#8ea2a5" stroke-width="${maj?1.4:1}"/>`;
    if(maj){const lab={0:'N',90:'E',180:'S',270:'W'}[dd]||String(dd/10);t+=`<text x="${x.toFixed(1)}" y="23" class="ml" fill="${dd%90?'#8ea2a5':'#e4ece9'}" text-anchor="middle">${lab}</text>`;}}
  cmpT.innerHTML=t;$('cmpH').textContent=String(Math.round(hd)||360).padStart(3,'0')+'°';
}
function resetWorld(){E.h=3000;E.vs=0;E.gam=0;E.kick=0;if(typeof FX!=="undefined"){FX.wb=FX.sb=FX.fb=-1;FX.ok=0;FX.perm=0;}}
/* Airframe effects: flaps move; past limit load the wings bend (tips up, or down when negative); at ultimate load (1.5x) they fail.
   Past VNE the tail flutters, and past VD (VNE/0.9) the horizontal tail lets go. In a stall the wing can only make (V/Vs)² G,
   so lift collapses, the airplane buffets and a wing drops. Structure repairs itself once you are back inside the limits. */
const FX={perm:0,fl:0,nEff:1,e:0,stall:false,flut:0,wb:-1,sb:-1,fb:-1,ok:0,t:0,drop:0};
function fxTick(dt){
  const lim=S.lim,d=derive(S.V,S.n,S.W,lim,S.flaps),V=S.V,run=L_.playing;dt=run?dt*L_.speed:0;FX.t+=dt;
  FX.fl+=Math.max(-dt*0.7,Math.min(dt*0.7,(S.flaps?1:0)-FX.fl));
  const nAv=(V/d.vsC)**2,nAvN=-KNEG*nAv;
  FX.stall=(S.n>0.05&&S.n>nAv)||(S.n<-0.05&&S.n<nAvN);
  let nE=FX.stall?(S.n>0?0.5*nAv:0.5*nAvN):S.n;
  FX.e=nE>lim.pos?(nE-lim.pos)/(0.5*lim.pos):nE<lim.neg?-(lim.neg-nE)/(-0.5*lim.neg):0;
  if(Math.abs(FX.e)>0.6*Math.abs(FX.perm))FX.perm=0.6*FX.e;   // permanent set: part of the bend stays after the load is gone
  if(Math.abs(FX.e)>=1&&FX.wb<0)FX.wb=0;
  if(V>lim.vne/0.9&&FX.sb<0)FX.sb=0;
  if(S.flaps&&FX.fl>0.3&&(V>lim.vfe*1.3||nE>lim.flapG*1.5)&&FX.fb<0)FX.fb=0;
  FX.flut=V>lim.vne?Math.min(1,(V-lim.vne)/(0.11*lim.vne)):0;
  if(FX.wb>=0)nE=0;FX.nEff=nE;
  for(const k of['wb','sb','fb'])if(FX[k]>=0)FX[k]+=dt;
  FX.drop+=((FX.stall?14:0)-FX.drop)*Math.min(1,dt*1.5);
}
function partTf(t,dir,spin,px,py){const o=Math.max(0,1-t/1.8);return[`translate(${dir*95*t} ${-70*t+170*t*t}) rotate(${dir*spin*t} ${px} ${py})`,o];}
function sceneTick(dt){
  if(!L_.playing)return;
  dt*=L_.speed;
  const br=S.bank*D2R,a=G0*(FX.nEff*Math.cos(br)-1),v=Math.max(S.V,1)*KT;
  E.vs+=(a-E.vs*0.5)*dt;E.vs=Math.max(-60,Math.min(60,E.vs));      // ft/s, lightly damped (drag/thrust settle it)
  E.gam=Math.atan2(E.vs,v);
  // pitch attitude = flight path + angle of attack. AOA from the lift the wing is making: 1° at zero... about 16° (critical) at the stall line.
  const dd=derive(S.V,S.n,S.W,S.lim,S.flaps),nAv=Math.max(0.01,(S.V/dd.vsC)**2);
  const aT=FX.wb>=0?0:FX.stall?20:Math.max(-12,Math.min(16,1+15*FX.nEff/nAv));
  if(FX.stall)E.kick+=(-24-E.kick)*Math.min(1,dt*2.5);else E.kick*=Math.exp(-dt*1.2);   // stall break: nose pitches down
  E.aoa+=(aT-E.aoa)*Math.min(1,dt*4);
  const thT=E.gam+(E.aoa+E.kick)*D2R;E.th+=(thT-E.th)*Math.min(1,dt*3.5);
  if(Math.abs(FX.nEff)>0.05&&S.bank>=0.5)E.psi+=G0*Math.tan(Math.min(br,1.45))/v*dt*Math.sign(FX.nEff);   // turn rate, rad/s
  const gs=v*Math.cos(E.gam);E.x+=Math.sin(E.psi)*gs*dt;E.y+=Math.cos(E.psi)*gs*dt;
  E.h=Math.max(400,Math.min(12000,E.h+E.vs*dt));
}
function drawFV(){
  const cx=200,cy=190,b=S.bank,n=FX.nEff,br=b*D2R,t=FX.t;
  // buffet + wing drop in a stall; flutter shake past VNE
  const bf=FX.stall?1:0,jx=bf*2.2*Math.sin(t*41)+FX.flut*1.2*Math.sin(t*63),jy=bf*1.8*Math.sin(t*37+1);
  $('plane').setAttribute('transform',`translate(${(cx+jx).toFixed(2)} ${(cy+jy).toFixed(2)}) rotate(${(b+FX.drop*(b<0?-1:1)+bf*2*Math.sin(t*19)).toFixed(2)}) scale(.8)`);
  const be=Math.abs(FX.e)>Math.abs(FX.perm)?FX.e:FX.perm,bend=Math.max(-1,Math.min(1,be))*16,wc=be===0?'#cfe0dd':(FX.e===0||Math.abs(be)<0.5?'#ffb54a':'#e2574a');
  for(const[id,dir,g]of[['wR',1,'gR'],['wL',-1,'gL']]){const el=$(id);let tf,o=1;
    if(FX.wb>=0){[tf,o]=partTf(FX.wb,dir,dir>0?250:300,dir*80,5);}else tf=`rotate(${(-dir*bend).toFixed(2)} ${dir*16} 13)`;
    el.setAttribute('transform',tf);el.setAttribute('opacity',o.toFixed(2));$(g).setAttribute('transform',tf);$(g).setAttribute('opacity',o.toFixed(2));
    el.querySelector('.wing').setAttribute('stroke',wc);}
  const fh=FX.fl*9+(S.flaps&&(S.V>S.lim.vfe||S.n>S.lim.flapG)?1.6*Math.sin(t*50):0);
  for(const[id,dir]of[['fR',1],['fL',-1]]){const el=$(id);el.setAttribute('d',`M${dir*22} 16.2 L${dir*76} 10.6 L${dir*76} ${(10.6+fh).toFixed(1)} L${dir*22} ${(16.2+fh).toFixed(1)}Z`);
    if(FX.fb>=0){const[tf,o]=partTf(FX.fb,dir*0.6,180,dir*50,14);el.setAttribute('transform',tf);el.setAttribute('opacity',o.toFixed(2));}else{el.removeAttribute('transform');el.setAttribute('opacity',FX.fl>0.02?1:0);}}
  const st=$('stab');if(FX.sb>=0){const[tf,o]=partTf(FX.sb,0.3,320,0,-8);st.setAttribute('transform',tf);st.setAttribute('opacity',o.toFixed(2));}
  else{st.setAttribute('transform',`rotate(${(FX.flut*5*Math.sin(t*58)).toFixed(2)} 0 -8)`);st.setAttribute('opacity',1);}
  const k=Math.min(64,150/Math.max(1,Math.abs(n)));
  const lx=cx+Math.sin(br)*n*k,ly=cy-Math.cos(br)*n*k;
  const vy=cy-Math.cos(br)*n*k,hx=cx+Math.sin(br)*n*k;
  const lr=lx>290;setArrow(AR_.lift,cx,cy,lx,ly,'LIFT '+Math.abs(n).toFixed(2)+'W',lr?Math.min(lx,392):lx+10,ly+(lr?-10:(n>=0?-6:14)),lr?'end':'start');
  const showC=b>2;
  setArrow(AR_.vert,cx,cy,cx,showC?vy:cy,'VERTICAL',cx-8,vy+4,'end');
  const hr=hx>300;setArrow(AR_.hor,cx,cy,showC?hx:cx,cy,'HORIZONTAL',hr?hx:hx+6,hr?cy-8:cy+4,hr?'end':'start');
  setArrow(AR_.wt,cx,cy,cx,cy+k,'WEIGHT',cx+8,cy+k-2,'start');
  if(b>2&&n>0){const r=40,ex=cx+Math.sin(br)*r,ey=cy-Math.cos(br)*r;$('arc').setAttribute('d',`M${cx} ${cy-r} A${r} ${r} 0 0 1 ${ex} ${ey}`);
    const t=$('arcT');t.textContent=Math.round(b)+'°';t.setAttribute('x',cx+Math.sin(br/2)*(r+12)-6);t.setAttribute('y',cy-Math.cos(br/2)*(r+12));}
  else{$('arc').setAttribute('d','');$('arcT').textContent='';}
  const nl=1/Math.cos(Math.min(b,80)*D2R);$('mcDot').setAttribute('cx',mcX(Math.min(b,80)));$('mcDot').setAttribute('cy',Math.max(MC.y,mcY(Math.min(nl,MC.n1))));
  {const cx2=66,cy2=123,th=E.th/D2R,gm=E.gam/D2R,hy=cy2+Math.max(-40,Math.min(40,th*1.2));
   $('pvH').setAttribute('y1',hy);$('pvH').setAttribute('y2',hy);
   $('pvA').setAttribute('transform',`translate(${cx2} ${cy2}) rotate(${(-th).toFixed(2)})`);
   const L=26,g=gm*D2R,vx=cx2+Math.cos(g)*L,vy=cy2-Math.sin(g)*L;$('pvV').setAttribute('x1',cx2);$('pvV').setAttribute('y1',cy2);$('pvV').setAttribute('x2',vx);$('pvV').setAttribute('y2',vy);
   $('pvT').textContent='PITCH '+(th>=0?'+':'')+Math.round(th)+'°';$('pvT2').textContent='AOA '+Math.round(E.aoa+E.kick*0)+'°';
   $('pvT2').setAttribute('fill',FX.stall?'#e2574a':E.aoa>13?'#ffb54a':'#8ea2a5');}
  const fpm=E.vs*60,pf=$('popFV');let msg=null,cls='a';
  if(FX.wb>=0){msg='WINGS FAILED · ULTIMATE LOAD';cls='r';}
  else if(FX.sb>=0){msg='TAIL FAILED · PAST VD';cls='r';}
  else if(FX.fb>=0){msg='FLAPS FAILED';cls='r';}
  else if(FX.e!==0&&!FX.stall){msg=(FX.e>0?'WINGS BENDING UP':'WINGS BENDING DOWN')+' · OVER LIMIT';cls='r';}
  else if(FX.flut>0){msg='FLUTTER · PAST VNE';cls='r';}
  else if(FX.stall){msg='STALL · NOSE DROPS · '+(Math.round(Math.abs(fpm)/50)*50).toLocaleString()+' FPM DOWN';cls='r';}
  else if(FX.perm!==0){msg='AIRFRAME BENT · RESET TO REPAIR';cls='a';}
  else if(Math.abs(fpm)>150)msg=(fpm<0?'DESCENDING ':'CLIMBING ')+(Math.round(Math.abs(fpm)/50)*50).toLocaleString()+' FPM';
  if(msg){pf.hidden=false;pf.className='pop '+cls;pf.textContent=msg;}else pf.hidden=true;
}

/* ================= V-g diagram ================= */
const vg=$('vg'),VB={W:640,H:420,l:46,r:14,t:16,b:36};
new ResizeObserver(es=>{const w=es[0].contentRect.width,W=w<560?440:640,H=w<560?400:420;if(W!==VB.W){VB.W=W;VB.H=H;vg.setAttribute('viewBox',`0 0 ${W} ${H}`);staticKey='';}}).observe(vg.parentElement);

function scales(){const lim=S.lim,Vd=lim.vne/0.9;
  const xMax=Math.ceil(Math.max(lim.vne*1.12,Vd*1.04)/10)*10,yMax=Math.ceil(lim.pos*1.5+0.4),yMin=Math.floor(lim.neg*1.5-0.4);   // room to drag past ultimate load (1.5x)
  const X=v=>VB.l+v/xMax*(VB.W-VB.l-VB.r),Y=n=>VB.t+(yMax-n)/(yMax-yMin)*(VB.H-VB.t-VB.b);
  return{xMax,yMax,yMin,X,Y};}
const f1=v=>v.toFixed(1);
function buildStatic(){
  const lim=S.lim,d=derive(S.V,S.n,S.W,lim,false),df=derive(S.V,S.n,S.W,lim,true),sc=SC=scales(),{X,Y,xMax,yMax,yMin}=sc,hl=S.hl;
  const H=k=>hl.includes(k)?' class="hl"':'';
  let s=`<defs><clipPath id="env"><path id="envP"/></clipPath></defs>`;
  s+=`<rect x="${X(0)}" y="${Y(yMax)}" width="${X(xMax)-X(0)}" height="${Y(yMin)-Y(yMax)}" fill="#0c1418"/>`;
  for(let v=0;v<=xMax;v+=10)s+=`<line x1="${X(v)}" x2="${X(v)}" y1="${Y(yMax)}" y2="${Y(yMin)}" stroke="#16242a" stroke-width="${v%50?0.8:1.3}"/>`;
  for(let n=yMin;n<=yMax;n++)s+=`<line x1="${X(0)}" x2="${X(xMax)}" y1="${Y(n)}" y2="${Y(n)}" stroke="${n===0?'#2c3f46':'#16242a'}" stroke-width="${n===0?1.4:1}"/><text x="${X(0)-6}" y="${Y(n)+3.5}" class="tk" text-anchor="end">${n>0?'+':''}${n}</text>`;
  for(let v=0;v<=xMax;v+=20)s+=`<text x="${X(v)}" y="${Y(yMin)+15}" class="tk" text-anchor="middle">${v}</text>`;
  s+=`<text x="${(X(0)+X(xMax))/2}" y="${VB.H-4}" class="ax" text-anchor="middle">INDICATED AIRSPEED · KIAS</text>`;
  s+=`<text x="12" y="${(Y(yMax)+Y(yMin))/2}" class="ax" text-anchor="middle" transform="rotate(-90 12 ${(Y(yMax)+Y(yMin))/2})">LOAD FACTOR · G</text>`;
  // envelope (clean)
  const pc=d.corner,nc=d.vs*Math.sqrt(-lim.neg/KNEG);
  let env='';for(let v=0;v<=pc;v+=1)env+=(v?'L':'M')+f1(X(v))+' '+f1(Y((v/d.vs)**2));
  env+=`L${f1(X(pc))} ${f1(Y(lim.pos))}L${f1(X(lim.vne))} ${f1(Y(lim.pos))}L${f1(X(lim.vne))} ${f1(Y(lim.neg))}L${f1(X(nc))} ${f1(Y(lim.neg))}`;
  for(let v=Math.floor(nc);v>=0;v-=1)env+=`L${f1(X(v))} ${f1(Y(-KNEG*(v/d.vs)**2))}`;env+='Z';
  s=s.replace('<path id="envP"/>',`<path d="${env}"/>`);
  s+=`<g clip-path="url(#env)"><rect x="${X(0)}" y="${Y(yMax)}" width="${X(lim.vno)-X(0)}" height="${Y(yMin)-Y(yMax)}" fill="#7fd98a" fill-opacity=".10"/>
      <rect x="${X(lim.vno)}" y="${Y(yMax)}" width="${X(lim.vne)-X(lim.vno)}" height="${Y(yMin)-Y(yMax)}" fill="#ffb54a" fill-opacity="${hl.includes('vno')?.24:.13}"/></g>`;
  // stall lines (+ faint extension past the corner: what the wing could pull if the structure allowed it)
  let st='',sx='',ns='';for(let v=0;v<=pc;v+=1)st+=(v?'L':'M')+f1(X(v))+' '+f1(Y((v/d.vs)**2));
  for(let v=pc;v<=xMax;v+=1){const n=(v/d.vs)**2;if(n>yMax)break;sx+=(sx?'L':'M')+f1(X(v))+' '+f1(Y(n));}
  for(let v=0;v<=nc;v+=1)ns+=(v?'L':'M')+f1(X(v))+' '+f1(Y(-KNEG*(v/d.vs)**2));
  s+=`<path d="${sx}" fill="none" stroke="#e2574a" stroke-opacity=".35" stroke-dasharray="4 4" stroke-width="1.4"/>`;
  s+=`<path d="${st}" fill="none" stroke="#e2574a" stroke-width="${hl.includes('stall')?3.4:2.2}" color="#e2574a"${H('stall')}/>`;
  s+=`<path d="${ns}" fill="none" stroke="#e2574a" stroke-width="${hl.includes('neg')?3.4:2.2}" color="#e2574a"${H('neg')}/>`;
  // structural limits + VNE
  s+=`<path d="M${X(pc)} ${Y(lim.pos)}H${X(lim.vne)}" stroke="#e4ece9" stroke-width="${hl.includes('limit')?3.4:2.2}" color="#e4ece9"${H('limit')}/>`;
  s+=`<path d="M${X(nc)} ${Y(lim.neg)}H${X(lim.vne)}" stroke="#e4ece9" stroke-width="${hl.includes('limit')||hl.includes('neg')?3.4:2.2}" color="#e4ece9"${hl.includes('limit')||hl.includes('neg')?' class="hl"':''}/>`;
  s+=`<path d="M${X(lim.vne)} ${Y(lim.pos)}V${Y(lim.neg)}" stroke="#e2574a" stroke-width="${hl.includes('vne')?4:2.6}" color="#e2574a"${H('vne')}/>`;
  s+=`<text x="${X(lim.vne)-6}" y="${Y(lim.pos)+15}" class="ml" fill="#e4ece9" text-anchor="end">+${lim.pos} G</text><text x="${X(lim.vne)-6}" y="${Y(lim.neg)-6}" class="ml" fill="#e4ece9" text-anchor="end">${lim.neg} G</text>`;
  // 1 G
  s+=`<line x1="${X(0)}" x2="${X(xMax)}" y1="${Y(1)}" y2="${Y(1)}" stroke="#8ea2a5" stroke-dasharray="2 5" stroke-width="1.2"/><text x="${X(xMax)-4}" y="${Y(1)-5}" class="tk" text-anchor="end">1 G</text>`;
  // gust lines
  if(S.gust){const g50=d.dn(lim.vno,50),g25=d.dn(d.Vd,25),gx=X(Math.min(d.Vd,xMax));const cl=hl.includes('gust')?' class="hl"':'';
    s+=`<g fill="none" stroke="#ef7fd1" stroke-width="1.6" stroke-dasharray="6 3" color="#ef7fd1"${cl}><path d="M${X(0)} ${Y(1)}L${X(lim.vno)} ${Y(Math.min(yMax,1+g50))}L${gx} ${Y(Math.min(yMax,1+g25))}"/><path d="M${X(0)} ${Y(1)}L${X(lim.vno)} ${Y(Math.max(yMin,1-g50))}L${gx} ${Y(Math.max(yMin,1-g25))}"/></g>`;
    s+=`<text x="${X(lim.vno)+4}" y="${Y(Math.min(yMax,1+g50))+16}" class="ml" fill="#ef7fd1" text-anchor="middle">50 ft/s gust ${1+g50>yMax?'>':''}${(1+Math.min(g50,yMax-1)).toFixed(1)} G</text>`;
    s+=`<line x1="${X(d.Vd)}" x2="${X(d.Vd)}" y1="${Y(yMax)}" y2="${Y(yMin)}" stroke="#ef7fd1" stroke-opacity=".5" stroke-dasharray="2 4"/><text x="${X(d.Vd)+3}" y="${Y(yMin)-6}" class="tk" fill="#ef7fd1">VD</text>`;}
  // flaps envelope
  if(S.flaps){const vsf=df.vso,fc=vsf*Math.sqrt(lim.flapG);let p='';for(let v=0;v<=fc;v+=1)p+=(v?'L':'M')+f1(X(v))+' '+f1(Y((v/vsf)**2));
    p+=`L${X(fc)} ${Y(lim.flapG)}H${X(lim.vfe)}V${Y(0)}H${X(0)}`;
    s+=`<path d="${p}" fill="#cfe0dd" fill-opacity=".10" stroke="#cfe0dd" stroke-width="${hl.includes('flaps')?3:2}" color="#cfe0dd"${H('flaps')}/><text x="${X(lim.vfe)-4}" y="${Y(lim.flapG)-6}" class="ml" fill="#cfe0dd" text-anchor="end">FLAPS +${lim.flapG} G</text>`;}
  // speed marks
  const marks=[[S.flaps?df.vso:d.vs,S.flaps?'VSO':'VS1','#e2574a',0],[d.vaW,'VA','#a99bff',1,'va'],[lim.vno,'VNO','#ffb54a',0,'vno'],[lim.vne,'VNE','#e2574a',1,'vne']];
  if(S.flaps)marks.push([lim.vfe,'VFE','#cfe0dd',2,'flaps']);
  for(const[v,t,c,row,k]of marks){const y0=Y(yMax),isH=k&&hl.includes(k);
    s+=`<line x1="${X(v)}" x2="${X(v)}" y1="${y0+12+row*12}" y2="${Y(yMin)}" stroke="${c}" stroke-opacity="${isH?.9:.45}" stroke-width="${isH?1.6:1}" stroke-dasharray="${t==='VA'?'5 4':'2 3'}"/>
        <text x="${X(v)}" y="${y0+9+row*12}" class="ml" fill="${c}" text-anchor="middle">${t} ${Math.round(v)}</text>`;}
  // corner (design maneuvering point)
  const cH=hl.includes('corner');
  s+=`<circle cx="${X(pc)}" cy="${Y(lim.pos)}" r="${cH?6:4}" fill="#a99bff" color="#a99bff"${cH?' class="hl"':''}/>`;
  if(cH)s+=`<text x="${X(pc)-8}" y="${Y(lim.pos)-8}" class="ml" fill="#a99bff" text-anchor="end">corner ${Math.round(pc)}</text>`;
  s+=`<text x="${X(0)+6}" y="${Y(yMin)-6}" class="tk">${lim.name} · ${Math.round(S.W).toLocaleString()} lb</text>`;
  // dynamic layer
  s+=`<g id="cur"><line id="cvx" stroke="#5ccfe3" stroke-opacity=".35" stroke-dasharray="3 4"/><line id="cvy" stroke="#5ccfe3" stroke-opacity=".35" stroke-dasharray="3 4"/>
       <circle id="cdot" r="8" fill="#5ccfe3" stroke="#0a1014" stroke-width="3"/><text id="ctx" class="ml" fill="#e4ece9"></text></g>`;
  vg.innerHTML=s;
}
function drawVG(){
  const key=[S.lim.name,S.lim.vs1,S.lim.vso,S.lim.va,S.lim.vfe,S.lim.vno,S.lim.vne,S.lim.pos,S.lim.neg,S.lim.flapG,S.lim.S,S.lim.b,S.lim.maxW,Math.round(S.W),S.flaps,S.gust,S.hl.join()].join('|');
  if(key!==staticKey){staticKey=key;buildStatic();}
  const{X,Y,xMax,yMax,yMin}=SC,V=Math.max(0,Math.min(xMax,S.V)),n=Math.max(yMin,Math.min(yMax,S.n));
  const d=derive(S.V,S.n,S.W,S.lim,S.flaps),st=status(S.V,S.n,d);
  const x=X(V),y=Y(n),c=st?(st[0]==='r'?'#e2574a':'#ffb54a'):'#5ccfe3';
  const cvx=$('cvx'),cvy=$('cvy'),cd=$('cdot'),tx=$('ctx');
  cvx.setAttribute('x1',x);cvx.setAttribute('x2',x);cvx.setAttribute('y1',Y(yMax));cvx.setAttribute('y2',Y(yMin));
  cvy.setAttribute('y1',y);cvy.setAttribute('y2',y);cvy.setAttribute('x1',X(0));cvy.setAttribute('x2',X(xMax));
  cd.setAttribute('cx',x);cd.setAttribute('cy',y);cd.setAttribute('fill',c);
  tx.textContent=Math.round(S.V)+' kt · '+S.n.toFixed(2)+' G';tx.setAttribute('x',x>X(xMax)-130?x-14:x+14);tx.setAttribute('y',y<Y(yMax)+40?y+22:y-12);tx.setAttribute('text-anchor',x>X(xMax)-130?'end':'start');
  const p=$('popVG');if(st){p.hidden=false;p.className='pop '+st[0];p.textContent=st[1];}else p.hidden=true;
  return d;
}

/* ================= Readouts ================= */
const fmt=n=>Math.round(n).toLocaleString();
function readouts(d){
  const n=S.n,V=S.V;
  $('rN').innerHTML=(n<0?'−':'')+Math.abs(n).toFixed(2)+'<small>G</small>';
  $('rN').className=(n>S.lim.pos||n<S.lim.neg)?'warnc':(S.flaps&&n>S.lim.flapG?'warnc':'');
  $('rVs').innerHTML=fmt(d.vsN)+'<small>KIAS</small>';
  const m=V-d.vsN;$('rM').innerHTML=(m>=0?'+':'−')+fmt(Math.abs(m))+'<small>kt</small>';$('rM').className=m<0?'warnc':(m<8?'ambc':'');
  const b=S.bank*D2R,vf=V*KT;
  if(S.bank>=1&&V>5){const tb=Math.tan(b);$('rR').innerHTML=(G0*tb/vf/D2R).toFixed(1)+'<small>°/s</small>';$('rRad').innerHTML=fmt(vf*vf/(G0*tb))+'<small>ft</small>';}
  else{$('rR').textContent='—';$('rRad').textContent='—';}
  $('rVa').innerHTML=fmt(d.vaW)+'<small>KIAS</small>';
  $('iasOut').textContent=Math.round(V)+' KIAS';$('bankOut').textContent=Math.round(S.bank)+'°';$('wtOut').textContent=fmt(S.W)+' lb';
}

/* ================= Guided lesson =================
   Ramps are [from,to,t0,t1] in seconds. n:'lvl' = level coordinated turn (1/cos bank), 'stall' = ride just inside the stall/limit edge.
   V:'va' tracks VA at the current weight. W is a fraction from min (0) to max (1) weight. */
const STEPS=[
{title:'Straight and level',dur:9,V:100,bank:0,n:'lvl',W:1,
 body:'In straight-and-level flight <b class="l">lift</b> equals <b class="s">weight</b>. The wing carries exactly what the airplane weighs: a <b>load factor</b> of 1 G.'},
{title:'Bank without back pressure',dur:11,V:100,bank:[0,30,1,4],n:1,W:1,
 body:'Roll into 30° and leave the elevator alone. Lift tilts with the wings. Only its <b class="l">vertical component</b> holds the airplane up, now 87% of the weight, so it <b>sinks</b>. The <b class="t">horizontal component</b> is what turns it.'},
{title:'Pull to hold altitude',dur:10,V:100,bank:30,n:[1,1.155,1,5],W:1,
 body:'Add back pressure until the vertical component matches weight again. Total lift must now be <b>1 / cos 30° = 1.15</b> times the weight. That extra lift is the load factor you feel in the seat.'},
{title:'Load factor climbs fast',dur:12,V:100,bank:[30,60,1,8],n:'lvl',W:1,
 body:'<b>n = 1 / cos(bank)</b>. A level 45° turn needs 1.41 G; 60° needs <b>2 G</b>. The wing now carries twice the airplane\'s weight, and everything in the cabin feels twice as heavy.'},
{title:'The curve goes vertical',dur:11,V:110,bank:[60,76,1,8],n:'lvl',W:1,
 body:'Past 60° the load factor curve shoots up (top-left chart). At 75° a level turn needs 3.8 G, the <b>limit load</b> of a normal-category airplane. No airplane can hold altitude at 90° of bank.'},
{title:'Stall speed rises',dur:12,V:85,bank:[0,60,1,8],n:'lvl',W:1,hl:['stall'],
 body:'More lift at the same speed means more angle of attack, so the wing reaches its critical angle sooner. Stall speed grows with <b>√n</b>: 50 KIAS wings-level becomes <b class="s">71 KIAS</b> at 60°. This is an <b>accelerated stall</b>.'},
{title:'The V-g diagram',dur:10,V:100,bank:0,n:'lvl',W:1,
 body:'The right-hand chart plots airspeed against load factor. The dot is you: speed along the bottom, G up the side. Every safe combination sits <b>inside the outline</b>; the colors match the airspeed indicator arcs.'},
{title:'The stall line',dur:13,V:[40,96,1,10],bank:0,n:'stall',W:1,hl:['stall'],
 body:'The curved left edge is the most G the wing can make at each speed: <b class="s">n = (V / Vs)²</b>. Ask for more and it stalls instead. At 1 G it crosses VS1 50; at 2 G it crosses 71 KIAS, the same as the 60° turn.'},
{title:'Structural limits',dur:11,V:125,bank:0,n:[1,3.8,1,7],W:1,hl:['limit'],
 body:'The flat top and bottom are the <b>limit load factors</b>: +3.8 and −1.52 G in the normal category. Beyond them parts can bend for good. The structure must hold <b>1.5 times</b> that (ultimate load) before it breaks.'},
{title:'Maneuvering speed',dur:14,V:[140,62,1,11],bank:0,n:'stall',W:1,hl:['corner','va'],
 body:'Where the stall line meets the limit is the <b class="v">corner</b>. Below it the wing stalls before it can overstress. The POH gives <b class="v">VA 113 KIAS</b>: the most for one full, abrupt input, in one axis. It does not protect against repeated or combined inputs.'},
{title:'Lighter means slower VA',dur:12,V:'va',bank:0,n:'stall',W:[1,0,1,9],hl:['corner','va'],
 body:'A lighter airplane stalls at a lower speed, so the corner and VA move <b>left</b>: VA scales with √(weight). In the PA-28 it falls from 113 KIAS at 2,550 lb to <b class="v">98 KIAS</b> at 1,917 lb. Light and turbulent: slow down more.'},
{title:'Gusts and the yellow arc',dur:14,V:[95,148,1,11],bank:0,n:1,W:1,gust:1,hl:['gust','vno'],
 body:'An up-gust raises angle of attack in an instant. The pink lines show the G from a <b>50 ft/s</b> gust. At VNO it already reaches about 3.5 G. That is why <b class="t">VNO to VNE</b>, the yellow arc, is for smooth air only.'},
{title:'Never exceed',dur:10,V:[140,160,1,6],bank:0,n:1,W:1,hl:['vne'],
 body:'<b class="s">VNE</b> is the red line, set at 90% of the speed the airplane was proven to in flight tests (VD). Past it flutter and structural failure become real risks, even at 1 G.'},
{title:'Pushing negative',dur:12,V:120,bank:0,n:[1,-1.4,1,8],W:1,hl:['neg'],
 body:'Pushing forward unloads the wing. Below 0 G, fuel, dirt and loose items float. The negative limit is only <b>−1.52 G</b>, and the wing stalls inverted at a higher speed, so the lower envelope is much smaller.'},
{title:'Flaps shrink the envelope',dur:13,V:[95,80,1,6],bank:[0,30,1,6],n:'lvl',W:1,flaps:1,hl:['flaps'],
 body:'Full flaps lower the stall to <b class="w">VSO 45 KIAS</b>, but the flaps-down structure is only built to <b class="w">+2.0 G</b>, and only up to <b class="w">VFE 102 KIAS</b>. Keep turns shallow with flaps out.'},
{title:'Category changes the box',dur:12,V:110,bank:0,n:[1,4.3,2,8],W:1,preset:'pa28u',hl:['limit'],
 body:'Below 2,130 lb the same PA-28 is approved in the <b>utility category</b>: +4.4 / −1.76 G, for limited maneuvers such as spins where approved. Aerobatic airplanes are built to +6 / −3 G.'},
{title:'Your turn',dur:0,
 body:'Drag the dot on the V-g diagram, or set speed, bank and weight below. Open <b>Limits</b> to pick another airplane or type in your own V-speeds and G limits. Push past a limit to see what gives first.'},
];

const DEEP=[
{refs:['phak5','acsI_F'],more:`<ul>
<li><b>Load factor</b> <span class="k">n = lift / weight</span>, in G. 1 G is unaccelerated flight. Your weight on the seat is your body weight × n.</li>
<li>Lift is not equal to weight in a climb or descent either: in a steady climb, lift is a little <b>less</b> than weight because thrust carries part of it.</li>
<li>The vertical component of lift is what holds altitude; the rest of lift does other work (turning, pulling up).</li></ul>`},
{refs:['phak5','afh3'],more:`<ul>
<li>The <b>horizontal component of lift</b> is the centripetal force that curves the flight path. The rudder does not turn the airplane; it keeps the turn coordinated (ball centered).</li>
<li>Rolling in without back pressure means vertical lift <span class="k">L·cos φ &lt; W</span>: the nose drops and the airplane descends. Beginners often see this as "the nose falls in a turn".</li>
<li>In a steep turn the outside wing travels faster and makes more lift: the <b>overbanking tendency</b> above about 30°. Hold opposite aileron as needed.</li></ul>`},
{refs:['phak5','afh3'],more:`<ul>
<li>Level turn: <span class="k">L cos φ = W</span>, so <span class="k">n = 1 / cos φ</span>. The airplane type, speed and weight do not change this number.</li>
<li>More lift at the same airspeed comes from more angle of attack, so <b>induced drag</b> rises too. Hold altitude and airspeed in a steep turn and you need <b>more power</b>.</li>
<li>30°: 1.15 G · 45°: 1.41 G · 60°: 2.00 G · 70°: 2.92 G · 80°: 5.76 G.</li></ul>`},
{refs:['phak5','acsV_A','afh10','p91_307'],more:`<ul>
<li>ACS PA.V.A <b>steep turns</b>: 45° ±5°, altitude ±100 ft, airspeed ±10 kt, rollout heading ±10°. Commercial CA.V.A: <b>50°</b> ±5°.</li>
<li>Turn rate <span class="k">ω = g·tan φ / V</span>, radius <span class="k">r = V² / (g·tan φ)</span> (true airspeed). Steeper bank or slower speed: faster, tighter turn. Watch both readouts.</li>
<li><b>14 CFR 91.307(c)</b>: with passengers, no intentional bank over <b>60°</b> or pitch over 30° unless everyone wears an approved parachute (certificate training with a CFI is excepted).</li></ul>`},
{refs:['phak5','p23_337'],more:`<ul>
<li>Bank for 3.8 G: <span class="k">acos(1/3.8) = 74.7°</span>; for 4.4 G (utility): 76.9°; for 6 G (aerobatic): 80.4°.</li>
<li>A light airplane usually runs out of <b>power</b> (it cannot hold speed and altitude) or out of <b>lift</b> (it stalls) before reaching limit load in a level turn. A descending spiral has neither limit: speed and G build fast. Level the wings first, then pull.</li>
<li>The old certification formula for the normal category: <span class="k">n ≥ 2.1 + 24,000/(W + 10,000)</span>, not more than 3.8 needed. Heavier airplanes may be certified lower.</li></ul>`},
{refs:['phak5','afh5','acsVII'],more:`<ul>
<li><span class="k">Vs(n) = Vs · √n</span>. 45°: +19%. 60°: +41%. 75°: +97%.</li>
<li>The critical angle of attack never changes; the <b>speed</b> at which you reach it does. Weight (√W), load factor, forward CG and ice all raise stall speed.</li>
<li>Accelerated stalls are often sharper and more likely to roll off. A skidding base-to-final turn adds yaw and can enter a <b>spin</b>. ACS PA.VII asks you to explain accelerated stalls and to recognize the cues.</li></ul>`},
{refs:['phak5','phak8'],more:`<ul>
<li>The V-g diagram is the <b>flight envelope</b> for one weight, one configuration and one altitude. Change any of those and the outline moves.</li>
<li>The FAA's figure uses calibrated or equivalent airspeed. This sim uses KIAS (IAS ≈ CAS ≈ EAS), which is close for a light airplane at low altitude.</li>
<li>Airspeed indicator arcs: <b>green</b> VS1 to VNO, <b>white</b> VSO to VFE, <b>yellow</b> VNO to VNE, <b>red line</b> VNE.</li></ul>`},
{refs:['phak5','afh5'],more:`<ul>
<li><span class="k">L = C<sub>L</sub>·½ρV²·S</span>. At C<sub>L,max</sub> lift grows with V², so the most G available is <span class="k">(V/Vs)²</span>.</li>
<li>Left of the curve, the airplane <b>cannot</b> be in steady flight: any attempt stalls the wing. That aerodynamic limit is a protection: at low speed you cannot overstress the airplane by pulling.</li>
<li>The faint dashed extension past the corner is what the wing <b>could</b> make if the structure allowed. That is the danger zone at high speed.</li></ul>`},
{refs:['phak5','p23_303','p23_337'],more:`<ul>
<li><b>Limit load</b>: the most load expected in service; the structure must take it with no permanent deformation. <b>Ultimate load</b> = limit × <b>1.5</b> (safety factor); the structure must hold it at least 3 seconds without failing.</li>
<li>Between limit and ultimate, parts can bend and stay bent; damage may not be visible. Over-G events need an inspection logged by a mechanic.</li>
<li>Negative limits (old 23.337(b)): at least <b>0.4×</b> the positive limit for normal and utility, 0.5× for aerobatic.</li></ul>`},
{refs:['phak5','p23_335','p23_1507','saib'],more:`<ul>
<li>Design maneuvering speed <span class="k">VA ≥ VS·√n<sub>limit</sub></span> (old 23.335(c)). The corner here is 50 × √3.8 ≈ <b>97 KIAS</b>; the POH's 113 sits above it. The rule sets a minimum, and published stall speeds are indicated values, so the two seldom match. <b>Fly the POH number.</b></li>
<li>The FAA SAIB CE-11-17 (2011): flying below VA does <b>not</b> protect against full deflection in more than one axis at once, or against <b>rapid alternating</b> inputs (rudder reversals). Those can break an airplane below VA.</li>
<li>VA is not marked on the airspeed indicator; it is in the POH limitations and on a placard.</li></ul>`},
{refs:['phak5','p23_1507','saib'],more:`<ul>
<li><span class="k">VA₂ = VA₁ · √(W₂/W₁)</span>: 113 × √(1917/2550) = 98.0 KIAS, matching the Piper table. Many POHs list 2–3 weights; interpolate.</li>
<li>Why: lighter means lower stall speed, so the stall line reaches the same limit G at a lower speed.</li>
<li>A lighter airplane also feels gusts more (less wing loading, below), so rough-air speed should come down with weight too.</li></ul>`},
{refs:['phak5','p23_341','p23_1505','aim7'],more:`<ul>
<li>Gust load factor (old 14 CFR 23.341): <span class="k">n = 1 ± K<sub>g</sub>·U<sub>de</sub>·V·a / (498·W/S)</span>, V in KEAS, U<sub>de</sub> in ft/s, a = lift slope per radian, K<sub>g</sub> = gust alleviation factor from the airplane's mass ratio.</li>
<li>Design gusts: <b>50 ft/s</b> at VC (design cruise speed, near VNO), <b>25 ft/s</b> at VD. Δn grows with speed and falls with wing loading: light airplanes ride gusts harder.</li>
<li>Turbulence: slow to VA or below (or the POH turbulent-air speed), keep wings level and accept altitude changes rather than fighting them. Report it in a PIREP.</li></ul>`},
{refs:['p23_1505','p23_335','phak8'],more:`<ul>
<li><span class="k">VNE ≤ 0.9 VD</span> and <span class="k">VNO ≤ 0.89 VNE</span> (old 23.1505). VD must be at least <b>1.25 VC</b>.</li>
<li>Flutter is a self-exciting vibration of a control surface or wing that can destroy it in seconds. Mass balance and rigging are designed to keep it beyond VD.</li>
<li>VNE is an indicated speed, but flutter margins depend on <b>true</b> airspeed. At high altitude TAS is higher for the same IAS, so some airplanes reduce VNE with altitude.</li></ul>`},
{refs:['phak5','afh5'],more:`<ul>
<li>A pushover to 0 G unloads the wing completely: no stall is possible at 0 G, which is why <b>unloading</b> is part of upset recovery.</li>
<li>The inverted stall line here assumes inverted C<sub>L,max</sub> ≈ 55% of upright (cambered wing). The exact value varies by airfoil.</li>
<li>Gravity-fed fuel and wet-sump engines are not built for sustained negative G: expect a power loss.</li></ul>`},
{refs:['phak5','p23_345','phak8'],more:`<ul>
<li>Flaps-extended design: <b>+2.0 G</b> up to VF (old 23.345), and 0 G negative in most light airplanes.</li>
<li>Flaps lower VS, so the flaps stall line is to the left, but it reaches 2.0 G at only <span class="k">VSO·√2 ≈ 64 KIAS</span>. A 60° bank with full flaps is at the structural limit.</li>
<li>C172S: VFE <b>110</b> KIAS for 10° flaps, <b>85</b> above 10°. Check the placarded VFE per flap setting in your POH.</li></ul>`},
{refs:['p23_337','p91_303','p1_2'],more:`<table><tr><th>Category</th><th>+ limit</th><th>− limit</th><th>Maneuvers</th></tr>
<tr><td>Normal</td><td>3.8</td><td>−1.52</td><td>Nonacrobatic: stalls, lazy eights, chandelles, steep turns ≤ 60°</td></tr>
<tr><td>Utility</td><td>4.4</td><td>−1.76</td><td>Normal + limited acrobatics (spins if approved), ≤ 90° bank</td></tr>
<tr><td>Aerobatic</td><td>6.0</td><td>−3.0</td><td>No restriction except as the AFM says</td></tr></table>
<ul><li>Many trainers hold both: utility only at lower weight and within a tighter CG range, with no rear seat passengers and no baggage. Check the POH.</li>
<li>Since 2017, Part 23 is performance-based (23.2200, design envelope) and uses levels rather than these numbers, but most trainers were certified under the old rules.</li></ul>`},
{refs:['phak5','afh3','afh5','afh10','acsV_A','acsVII','caV_A'],more:`<ul>
<li>Try: 60° bank at 70 KIAS. Where is the dot, and what is the stall margin?</li>
<li>Find the lightest weight where a 50 ft/s gust at VNO exceeds the limit (turn on Gust lines).</li>
<li>Set a custom airplane in Limits with VA below the corner speed and see which protection you lose.</li>
<li>Model: steady coordinated flight, IAS ≈ EAS, sea-level density for turn and gust numbers.</li></ul>`},
];
STEPS.forEach((s,i)=>Object.assign(s,DEEP[i]||{}));

const L_={step:0,t:0,mode:'tour',playing:true,speed:1};
const dotsEl=$('dots');
STEPS.forEach((st,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Step '+(i+1)+': '+st.title);b.onclick=()=>goStep(i,true);dotsEl.appendChild(b);});
function rv(x,t){if(Array.isArray(x)){const[a,b,t0,t1]=x,k=Math.max(0,Math.min(1,(t-t0)/(t1-t0)));return a+(b-a)*k*k*(3-2*k);}return x;}
function lvl(b){return 1/Math.cos(Math.min(b,85)*D2R);}
function setLim(l){S.lim=l;const w=$('wt');w.min=l.minW;w.max=l.maxW;T.W=Math.max(l.minW,Math.min(l.maxW,T.W));S.W=Math.max(l.minW,Math.min(l.maxW,S.W));
  const sc=scales();$('ias').max=sc.xMax;}
function setTog(id,key,v){S[key]=!!v;$(id).setAttribute('aria-pressed',!!v);}
function tourTargets(st,t){
  const lim=S.lim;T.W=lim.minW+(lim.maxW-lim.minW)*rv(st.W,t);
  T.bank=rv(st.bank,t);
  const d=derive(0,1,T.W,lim,S.flaps);
  T.V=st.V==='va'?d.vaW:rv(st.V,t);
  if(st.n==='lvl')T.n=lvl(T.bank);
  else if(st.n==='stall')T.n=Math.min(lim.pos,0.97*(T.V/d.vs)**2);
  else T.n=rv(st.n,t);
}
function goStep(i,manual,keep){
  i=Math.max(0,Math.min(STEPS.length-1,i));L_.step=i;L_.t=0;const st=STEPS[i];
  L_.mode=i===STEPS.length-1?'explore':'tour';if(!keep)resetWorld();
  $('stepNum').textContent='Step '+(i+1)+' of '+STEPS.length;$('stepTitle').textContent=st.title;$('stepBody').innerHTML=st.body;
  [...dotsEl.children].forEach((b,k)=>{b.className=k===i?'on':(k<i?'done':'');b.setAttribute('aria-current',k===i?'step':'false');});
  $('explore').hidden=L_.mode==='explore';Kit.step(st);$('next').disabled=i===STEPS.length-1;$('prev').disabled=i===0;
  if(L_.mode==='explore'){S.hl=[];setLim(userLim);
    if(!keep){setTog('tFl','flaps',false);setTog('tGu','gust',false);T.V=100;T.bank=0;T.n=1;T.W=userLim.maxW;}
    syncInputs();return;}
  setLim(PRESETS[st.preset||'pa28n']);S.hl=st.hl||[];setTog('tFl','flaps',st.flaps);setTog('tGu','gust',st.gust);
  tourTargets(st,0);syncInputs();
}
function lessonTick(dt){const st=STEPS[L_.step];
  if(L_.mode==='tour'&&L_.playing){L_.t+=dt*L_.speed;tourTargets(st,L_.t);syncInputs();if(st.dur&&L_.t>=st.dur)goStep(L_.step+1);}
  $('stepBar').style.width=(st.dur?Math.min(1,L_.t/st.dur)*100:100)+'%';}
function syncInputs(){$('ias').value=T.V;$('bank').value=T.bank;$('wt').value=T.W;}
function toExplore(){if(L_.mode==='tour')goStep(STEPS.length-1,true,true);}
$('prev').onclick=()=>goStep(L_.step-1,true);$('next').onclick=()=>goStep(L_.step+1,true);
$('explore').onclick=()=>goStep(STEPS.length-1,true);
function setPlay(v){L_.playing=v;$('play').textContent=v?'Pause':'Play';}
$('play').onclick=()=>setPlay(!L_.playing);
$('speed').addEventListener('input',e=>{L_.speed=+e.target.value;$('speedTxt').textContent=L_.speed+'×';});
Kit.mount({pause:()=>setPlay(false),sources:['phak5','phak8','afh3','afh5','afh10','acsI_F','acsV_A','acsVII','caV_A','p1_2','p91_303','p91_307','p23_303','p23_335','p23_337','p23_341','p23_345','p23_1505','p23_1507','aim7','saib']});
if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)setPlay(false);

/* ================= Explore controls ================= */
$('ias').addEventListener('input',e=>{toExplore();T.V=+e.target.value;});
$('bank').addEventListener('input',e=>{toExplore();T.bank=+e.target.value;T.n=lvl(T.bank);});
$('wt').addEventListener('input',e=>{toExplore();T.W=+e.target.value;S.W=T.W;});
$('tFl').onclick=()=>{toExplore();setTog('tFl','flaps',!S.flaps);};
$('tGu').onclick=()=>{toExplore();setTog('tGu','gust',!S.gust);};
$('resetBtn').onclick=()=>{goStep(STEPS.length-1,true,false);};
// drag on the V-g diagram
let drag=false;
function vgPick(e){const pt=vg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(vg.getScreenCTM().inverse());
  const{xMax,yMax,yMin}=SC,V=(p.x-VB.l)/(VB.W-VB.l-VB.r)*xMax,n=yMax-(p.y-VB.t)/(VB.H-VB.t-VB.b)*(yMax-yMin);
  T.V=S.V=Math.max(0,Math.min(xMax,V));T.n=S.n=Math.max(yMin,Math.min(yMax,n));
  T.bank=S.bank=T.n>=1?Math.acos(1/T.n)/D2R:0;syncInputs();}
vg.addEventListener('pointerdown',e=>{e.preventDefault();toExplore();drag=true;vg.setPointerCapture(e.pointerId);vgPick(e);});
vg.addEventListener('pointermove',e=>{if(drag)vgPick(e);});
vg.addEventListener('pointerup',()=>drag=false);vg.addEventListener('pointercancel',()=>drag=false);

/* ================= Limits popup ================= */
const dlg=$('limDlg'),sel=$('limPreset'),grid=$('limGrid');
sel.innerHTML=Object.entries(PRESETS).map(([k,p])=>`<option value="${k}">${p.name}</option>`).join('')+'<option value="custom">Custom</option>';
grid.innerHTML=FIELDS.map(f=>f[0]==='h'?`<h3>${f[1]}</h3>`:`<label for="lf_${f[0]}"><span>${f[1]}${f[2]?' · '+f[2]:''}</span><input id="lf_${f[0]}" type="number" inputmode="decimal" step="any"></label>`).join('');
function fillLim(){sel.value=userKey;for(const f of FIELDS)if(f[0]!=='h'){const el=$('lf_'+f[0]);el.value=userLim[f[0]];el.setAttribute('aria-invalid','false');}}
function readLim(){const l={name:'Custom'};for(const f of FIELDS)if(f[0]!=='h')l[f[0]]=parseFloat($('lf_'+f[0]).value);return l;}
grid.addEventListener('input',()=>{const l=readLim(),ok=valid(l);
  for(const f of FIELDS)if(f[0]!=='h')$('lf_'+f[0]).setAttribute('aria-invalid',String(!Number.isFinite(l[f[0]])||!ok));
  if(!ok)return;userKey='custom';sel.value='custom';userLim=l;setLim(userLim);saveLim();});
sel.onchange=()=>{if(sel.value==='custom')return;userKey=sel.value;userLim={...PRESETS[userKey]};fillLim();setLim(userLim);T.W=userLim.maxW;S.W=T.W;syncInputs();saveLim();};
$('limReset').onclick=()=>{const k=userKey==='custom'?'pa28n':userKey;userKey=k;userLim={...PRESETS[k]};fillLim();setLim(userLim);T.W=userLim.maxW;S.W=T.W;syncInputs();saveLim();};
$('limBtn').onclick=()=>{toExplore();setPlay(false);fillLim();dlg.showModal();};
$('limClose').onclick=()=>dlg.close();
dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close();});

/* ================= Loop ================= */
let lastT=performance.now();
function frame(now){
  const dt=Math.min(0.05,(now-lastT)/1000);lastT=now;
  lessonTick(dt);
  if(!drag){const k=Math.min(1,dt*6*Math.max(1,L_.speed));for(const key of['V','bank','n','W']){const e=T[key]-S[key];S[key]+=Math.abs(e)<1e-3?e:e*k;}}
  fxTick(dt);sceneTick(dt);drawWorld();const d=drawVG();drawFV();readouts(d);
  requestAnimationFrame(frame);}
goStep(0);S.V=T.V;S.bank=T.bank;S.n=T.n;S.W=T.W;requestAnimationFrame(frame);

}
