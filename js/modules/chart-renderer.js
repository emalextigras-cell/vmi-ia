/** Rendu SVG des graphiques et infobulles tactiles. */
import { absoluteHumidity } from './psychrometry.js';
import { pad, dayStart } from './date-utils.js';
const COLORS=['#286348','#c16b32','#356da5'];
const fmtTick=(t,withHour)=>{const d=new Date(t);return withHour?`${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}h`:`${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(2)}`};
const fmtPoint=(t,daily)=>{const d=new Date(t);return daily?`${pad(d.getHours())}:${pad(d.getMinutes())}`:`${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`};
/* Comble seulement les valeurs manquantes isolées (≤ 2 relevés consécutifs et ≤ 3 h) ; au-delà, le trait est interrompu. */
function fillMissing(points){
 const out=points.map(p=>({t:p.t,v:Number.isFinite(p.v)?p.v:null}));
 let i=0;
 while(i<out.length){
  if(out[i].v!=null){i++;continue}
  let j=i;while(j<out.length&&out[j].v==null)j++;
  if(i>0&&j<out.length){
   const a=out[i-1],b=out[j];
   if(j-i<=2&&b.t-a.t<=3*3600000){const span=(b.t-a.t)||1;for(let k=i;k<j;k++)out[k].v=a.v+(b.v-a.v)*((out[k].t-a.t)/span)}
  }
  i=j;
 }
 return out.filter(p=>p.v!=null);
}
function drawChart(id,title,series,selectedDate,$){
 const el=$(id),all=series.flatMap(s=>s.points.filter(p=>Number.isFinite(p.v)));
 if(!all.length){el.innerHTML='<p class="note">Pas de données disponibles pour cette période.</p>';return}
 const W=700,H=215,L=48,R=12,T=18,B=30;
 const daily=!!selectedDate;
 let x0,x1;
 if(daily){x0=dayStart(selectedDate);x1=x0+86400000}
 else{x0=Math.min(...all.map(p=>p.t));x1=Math.max(...all.map(p=>p.t));if(x0===x1)x1=x0+3600000}
 const vals=all.map(p=>p.v);let y0=Math.min(...vals),y1=Math.max(...vals);if(y0===y1){y0-=1;y1+=1}
 const margin=(y1-y0)*.1;y0-=margin;y1+=margin;
 const X=t=>L+(t-x0)/(x1-x0)*(W-L-R),Y=v=>T+(1-(v-y0)/(y1-y0))*(H-T-B);
 let svg='';
 for(let i=0;i<=4;i++){const v=y0+(y1-y0)*i/4,y=Y(v);svg+=`<line class="gridline" x1="${L}" x2="${W-R}" y1="${y}" y2="${y}"/><text x="${L-7}" y="${y+3}" text-anchor="end">${v.toFixed(1)}</text>`}
 if(daily){for(let h=0;h<=24;h+=3){const x=X(x0+h*3600000);svg+=`<line class="gridline" x1="${x}" x2="${x}" y1="${T}" y2="${H-B}"/><text x="${x}" y="${H-10}" text-anchor="${h===0?'start':h===24?'end':'middle'}">${pad(h)}h</text>`}}
 else{const span=x1-x0,withHour=span<=3*86400000;for(let i=0;i<=4;i++){const t=x0+span*i/4,x=X(t);svg+=`<text x="${x}" y="${H-10}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${fmtTick(t,withHour)}</text>`}}
 /* seuil de trou calculé série par série : le trait est interrompu quand des relevés manquent */
 const gaps=new Map();
 for(const s of series){const dts=[];for(let i=1;i<s.points.length&&dts.length<400;i++)dts.push(s.points[i].t-s.points[i-1].t);dts.sort((a,b)=>a-b);gaps.set(s,Math.max(4*3600000,6*(dts.length?dts[Math.floor(dts.length/2)]:0)))}
 for(const s of series){
  const pts=s.points.filter(p=>Number.isFinite(p.v));if(!pts.length)continue;
  const gap=gaps.get(s),step=Math.max(1,Math.ceil(pts.length/600));
  const sel=pts.filter((p,i)=>i%step===0||i===pts.length-1);
  let d='',prev=null,segLen=0,dots='';
  sel.forEach(p=>{
   if(prev===null||p.t-prev.t>gap){if(segLen===1)dots+=`<circle cx="${X(prev.t).toFixed(1)}" cy="${Y(prev.v).toFixed(1)}" r="1.8" fill="${s.color}"/>`;d+=`M${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`;segLen=1}
   else{d+=`L${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`;segLen++}
   prev=p;
  });
  if(segLen===1&&prev)dots+=`<circle cx="${X(prev.t).toFixed(1)}" cy="${Y(prev.v).toFixed(1)}" r="1.8" fill="${s.color}"/>`;
  svg+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round"/>${dots}`;
 }
 const legend=series.map(s=>`<span><i class="dot" style="background:${s.color}"></i>${s.name}</span>`).join('');
 el.innerHTML=`<div class="legend">${legend}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">${svg}<line id="${id}Cur" class="gridline" y1="${T}" y2="${H-B}" x1="0" x2="0" style="display:none"/></svg><div class="tip"></div>`;
 /* Infobulle : pour chaque courbe, le relevé le plus proche du doigt */
 const svgEl=el.querySelector('svg'),tip=el.querySelector('.tip'),cursor=el.querySelector('#'+id+'Cur');
 const move=e=>{
  const rect=svgEl.getBoundingClientRect(),w=rect.width||W;
  const tVal=x0+((e.clientX-rect.left)*(W/w)-L)/(W-L-R)*(x1-x0);
  let txt=null,tShown=null;
  for(const s of series){
   let q=null;
   for(const p of s.points){if(!Number.isFinite(p.v))continue;const dd=Math.abs(p.t-tVal);if(q===null||dd<q.dd)q={dd,t:p.t,v:p.v}}
   if(q&&q.dd<=Math.max(1800000,(x1-x0)/50)){if(txt===null){txt=fmtPoint(q.t,daily)+' · ';tShown=q.t}txt+=`${s.name} ${q.v.toFixed(1)}  `}
  }
  if(txt===null)return;
  tip.textContent=txt.trim();tip.style.display='block';
  const cr=el.getBoundingClientRect();
  tip.style.left=Math.max(0,Math.min(e.clientX-cr.left+8,cr.width-tip.offsetWidth-2))+'px';tip.style.top='22px';
  const cx=X(tShown);cursor.setAttribute('x1',cx);cursor.setAttribute('x2',cx);cursor.style.display='block';
 };
 svgEl.addEventListener('pointermove',move);svgEl.addEventListener('pointerdown',move);
 svgEl.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'){tip.style.display='none';cursor.style.display='none'}});
}
function seriesFor(data,key,name,color,derive=null){
 const points=data.map(r=>({t:r.t,v:derive?derive(r):r[key]}));
 return {name,color,points:fillMissing(points)};
}
export function renderCharts(data,selectedDate,$){
 drawChart('chartRH','Humidité relative',[
  seriesFor(data,'sh','Salon',COLORS[0]),seriesFor(data,'h1','Sonde résistances',COLORS[1]),seriesFor(data,'he','Air entrant',COLORS[2])],selectedDate,$);
 drawChart('chartHA','Humidité absolue',[
  seriesFor(data,'sh','Salon',COLORS[0],r=>absoluteHumidity(r.st,r.sh)),
  seriesFor(data,'he','Air entrant',COLORS[2],r=>absoluteHumidity(r.te,r.he))],selectedDate,$);
 drawChart('chartTemp','Températures',[
  seriesFor(data,'st','Salon',COLORS[0]),seriesFor(data,'t1','Sonde résistances',COLORS[1]),seriesFor(data,'te','Air entrant',COLORS[2])],selectedDate,$);
 drawChart('chartRPM','Régime ventilateur',[seriesFor(data,'rpm','Régime',COLORS[0])],selectedDate,$);
}
