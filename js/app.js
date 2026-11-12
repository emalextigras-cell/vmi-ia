import { DAY, pad, localDay, dayStart, shiftDay, fmt, num, MIN_VALID, HIST_MAX } from './modules/date-utils.js';
import { $, sleep, APP_VERSION } from './modules/core.js';
import { createStore } from './modules/store.js';
import { median } from './modules/analysis.js';
import { renderCharts } from './modules/charts.js';
import { SVC_C, CH_C, SVC_T, CH_T, crc, frame, timeFrame, hex } from './modules/ble.js';
import { armDownloadTimeout } from './modules/sync.js';
import { parseCell, recFrom, dayNumber } from './modules/dataio.js';
import { absoluteHumidity, dewPoint, psychro, validTemp } from './modules/psychrometry.js';

'use strict';

if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{})}

/* Protocole Bluetooth : UUID, registres et positions d'octets déduits d'une capture réelle de VMI+. */





const errors=[];
function recordError(m){
 errors.push(new Date().toLocaleTimeString('fr-FR')+' '+m);if(errors.length>30)errors.shift();
 const b=$('errBanner');b.textContent='⚠ Une erreur interne est survenue ('+errors.length+'). Touche « Diagnostic » (en bas de page) pour la copier.';b.style.display='block';
}
window.addEventListener('error',e=>recordError('Erreur : '+(e.message||(e.error&&e.error.message)||'inconnue')+(e.filename?' ('+String(e.filename).split('/').pop()+':'+e.lineno+')':'')));
window.addEventListener('unhandledrejection',e=>recordError('Promesse rejetée : '+((e.reason&&e.reason.message)||e.reason)));











let dev=null,chC=null,chT=null,pollTimer=null,snapTimer=null,reconnectTimer=null;
let manualDisconnect=false,commandQueue=Promise.resolve(),manualCommandPending=false,polling=false,autoDone=false;
let meta={},cur={},lastSeen={},live=[],hist=[],source='hist',selectedDate=null,daysSetting=30;
let logLines=[],dlFrames=0;
let download={on:false,rows:[],buf:'',total:0,sigs:new Set(),got:false,lastPacket:0,timeout:null};
const DB='VMI_PUREVENT_DB',STORE='data';
const { get: dbGet, set: dbSet } = createStore({ databaseName: DB, storeName: STORE, onError: message => log(message) });
const connected=()=>!!(chC&&dev&&dev.gatt&&dev.gatt.connected);

function showError(e){$('err').textContent=e?String(e.message||e):''}
function renderLog(){const p=$('log');p.textContent=logLines.slice(-70).join('\n');p.scrollTop=p.scrollHeight}
function log(s){logLines.push(`${new Date().toLocaleTimeString('fr-FR')} ${s}`);if(logLines.length>300)logLines.shift();if($('logDetails').open)renderLog()}
$('logDetails').addEventListener('toggle',()=>{if($('logDetails').open)renderLog()});
function setStatus(s,isConnected=false){$('st').textContent=s;$('bleState').textContent=isConnected?'Connecté':'Déconnecté';$('conn').disabled=isConnected;$('disc').disabled=!isConnected}

/* Reprise des données des anciennes versions (heure affichée mémorisée comme de l'UTC) */
const wallUtcToLocal=t=>{const d=new Date(t);return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds()).getTime()};
const fromOldRow=a=>({t:wallUtcToLocal(a[0]),st:a[1],sh:a[2],t1:a[3],h1:a[4],te:a[5],he:a[6],rpm:a[7],fil:a[8],vit:null,boost:null,hol:null});
async function readOldDatabase(){
 try{
  if(!indexedDB.databases)return null;
  const list=await indexedDB.databases();
  if(!list.some(d=>d.name==='VMI_DB'))return null;
  const old=await new Promise((res,rej)=>{const r=indexedDB.open('VMI_DB');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  if(!old.objectStoreNames.contains('vmi_store')){old.close();return null}
  const get=k=>new Promise((res,rej)=>{const r=old.transaction('vmi_store','readonly').objectStore('vmi_store').get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  const out={hist:await get('vmi_hist'),live:await get('vmi_live')};old.close();return out;
 }catch(e){return null}
}
async function init(){
 let l=await dbGet('live'),h=await dbGet('hist');
 live=Array.isArray(l)?l:[];hist=Array.isArray(h)?h:[];
 meta=(await dbGet('meta'))||{};
 const migrated=await dbGet('migrated');
 if(!migrated&&!hist.length&&!live.length){
  const old=await readOldDatabase();
  if(old){
   if(Array.isArray(old.hist))hist=old.hist.map(fromOldRow);
   if(Array.isArray(old.live))live=old.live;
  }
  if(!hist.length){try{const x=JSON.parse(localStorage.getItem('vmi_hist')||'[]');if(Array.isArray(x))hist=x.map(fromOldRow)}catch(e){}}
  if(!live.length){try{const x=JSON.parse(localStorage.getItem('vmi_live')||'[]');if(Array.isArray(x))live=x}catch(e){}}
  await dbSet('migrated',true);
 }
 /* Les relevés datés d'avant 2025 ont une date fausse (horloge de la VMI) et ne peuvent pas être corrigés
    sans leur compteur de jours : on les retire, un nouvel import ou téléchargement les rétablit avec la bonne date. */
 const bad=hist.filter(r=>!(r&&r.t>=MIN_VALID)).length;
 if(bad){hist=hist.filter(r=>r&&r.t>=MIN_VALID);$('importInfo').textContent=`${bad} anciens relevés à date invalide ont été retirés. Réimporte ton export VMI+ ou récupère l’historique : ils reviendront avec la bonne date.`}
 hist.sort((a,b)=>a.t-b.t);
 await dbSet('hist',hist);if(live.length)await dbSet('live',live);
 $('liveCount').textContent=live.length;render();
}
function pruneHist(){
 hist=hist.filter(r=>r&&(r.st!=null||r.sh!=null||r.te!=null||r.he!=null||r.rpm!=null||r.t1!=null||r.h1!=null));
 if(hist.length>HIST_MAX){hist=hist.slice(hist.length-HIST_MAX);log(`Historique limité à ${HIST_MAX} relevés (les plus anciens supprimés).`)}
}

/* Psychrométrie : approximation de Magnus */














/* Trames */




function writeFrame(bytes){
 const task=commandQueue.then(async()=>{
  if(!connected())throw new Error('VMI non connectée');
  if(chC.properties&&chC.properties.write&&typeof chC.writeValueWithResponse==='function'){
   await chC.writeValueWithResponse(bytes);
  }else if(chC.properties&&chC.properties.writeWithoutResponse&&typeof chC.writeValueWithoutResponse==='function'){
   await chC.writeValueWithoutResponse(bytes);
  }else if(typeof chC.writeValue==='function'){
   await chC.writeValue(bytes);
  }else{
   throw new Error('Cette caractéristique Bluetooth ne permet pas l’écriture.');
  }
  log('> '+hex(bytes));
  await sleep(350);
  return true;
 });
 const result=task.catch(e=>{
  showError('Échec de l’envoi Bluetooth : '+(e.message||e));
  log('Erreur commande : '+(e.message||e));
  return false;
 });
 commandQueue=result.then(()=>{},()=>{});
 return result;
}
const send=(reg,val)=>writeFrame(frame(reg,val));
async function setClock(){if(!chC){showError('Connecte-toi d’abord à la VMI.');return false}const d=new Date();const ok=await writeFrame(timeFrame(d));$('dlp').textContent=ok?'Heure envoyée : '+d.toLocaleString('fr-FR'):'Heure non envoyée.';return ok}

function onNotification(ev){
 try{handleNotification(ev)}catch(e){log('Erreur de décodage d’une trame : '+(e.message||e));recordError('Décodage d’une trame : '+(e.message||e))}
}
function handleNotification(ev){
 const v=ev.target.value;
 const a=new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
 if(a.length<3||a[0]!==0xA5||a[1]!==0xB6)return;
 const type=a[2],now=Date.now();
 if(type===0x30){
  if(!download.on)return;
  if(a.length<14){log('Trame d’historique trop courte, ignorée.');return}
  dlFrames++;if(dlFrames%200===1)log(`< trames d’historique reçues : ${dlFrames}`);
  download.got=true;download.lastPacket=now;
  let end=14;while(end<a.length&&a[end]!==0)end++;
  download.buf+=new TextDecoder('latin1').decode(a.slice(14,end));
  const lines=download.buf.split('\n');download.buf=lines.pop();lines.forEach(parseDownloadLine);
  if(download.on){
   $('dlp').textContent=`${download.rows.length} nouvelles lignes (${a[9]|(a[10]<<8)} / ${download.total||'?'} lues)`;
   armTimer();
   if(a[13]===1){if(download.buf.trim())parseDownloadLine(download.buf);finishDownload(false)}
  }
  return;
 }
 log('< '+hex(a));
 if(type===1&&a.length>53){
  cur.filtre=a[28];cur.jours=a[26];cur.vol=a[22]|(a[23]<<8);cur.tmax=a[38];
  cur.vit=a[34]+1;cur.boost=a[44];cur.hol=a[43];cur.rpm=null;
  lastSeen.state=now;
  $('fi').textContent=cur.filtre;$('jf').textContent=cur.jours;$('vo').textContent=cur.vol;$('tm').textContent=cur.tmax;
  $('sp').textContent=cur.vit;$('bo').textContent=cur.boost?'Actif':'Arrêté';$('ho').textContent=cur.hol?'Actif':'Arrêté';
 }
 else if(type===2&&a.length>13){
  cur.sal_t=a[11];cur.sal_h=a[13];lastSeen.salon=now;
  $('tp').textContent=cur.sal_t;$('hp').textContent=cur.sal_h;
 }
 else if(type===3&&a.length>13){
  cur.s1_t=a[6];cur.s1_h=a[8];cur.s2_t=a[11];cur.s2_h=a[13];lastSeen.probes=now;
  $('ti').textContent=cur.s1_t;$('hi').textContent=cur.s1_h;$('t2').textContent=cur.s2_t;$('h2').textContent=cur.s2_h;
 }
 else if(type===4&&a.length>7){download.total=a[6]|(a[7]<<8);return}
 else return;
 updateLiveMetrics();
}
function updateLiveMetrics(){
 const freshest=Math.max(lastSeen.salon||0,lastSeen.probes||0);
 $('sampleAge').textContent=lastSeen.salon&&lastSeen.probes?'Dernières mesures reçues : '+Math.max(0,Math.round((Date.now()-freshest)/1000))+' s':'Mesures partielles : en attente des deux trames capteurs.';
 const r={st:cur.sal_t,sh:cur.sal_h,te:cur.s2_t,he:cur.s2_h};
 const p=psychro(r);
 $('haSalon').textContent=fmt(p.haIn);$('haExt').textContent=fmt(p.haOut);$('dew').textContent=fmt(p.dewIn);$('dewExt').textContent=fmt(p.dewOut);
 $('deltaHA').textContent=p.haIn!=null&&p.haOut!=null?fmt(p.haIn-p.haOut):'–';
 $('deltaT').textContent=validTemp(r.st)&&validTemp(r.te)?fmt(r.st-r.te):'–';
 const box=$('hygroAdvice');
 if(p.haIn==null||p.haOut==null){box.className='advice';box.textContent='En attente de mesures valides pour comparer les masses de vapeur d’eau.';return}
 const delta=p.haIn-p.haOut;
 if(delta>1){box.className='advice good';box.textContent=`L’air entrant contient environ ${fmt(delta)} g/m³ de vapeur d’eau en moins que l’air du salon. Dans ces conditions, le renouvellement d’air peut contribuer à réduire l’humidité intérieure.`}
 else if(delta< -1){box.className='advice warn';box.textContent=`L’air entrant contient environ ${fmt(Math.abs(delta))} g/m³ de vapeur d’eau de plus que l’air du salon. Une ventilation accrue ne garantit donc pas un assèchement.`}
 else{box.className='advice';box.textContent='Les humidités absolues sont proches. L’effet asséchant potentiel de l’air entrant est limité à cet instant.'}
}

/* Relevés en direct : dès que le salon est frais, avec les sondes si elles le sont aussi */
function takeSnapshot(){
 const now=Date.now();
 if(!lastSeen.salon||now-lastSeen.salon>90000)return;
 const pf=lastSeen.probes&&now-lastSeen.probes<=90000;
 const row={t:now,st:cur.sal_t,sh:cur.sal_h,t1:pf?cur.s1_t:null,h1:pf?cur.s1_h:null,te:pf?cur.s2_t:null,he:pf?cur.s2_h:null,
  rpm:null,fil:Number.isFinite(cur.filtre)?cur.filtre:null,vit:Number.isFinite(cur.vit)?cur.vit:null,
  boost:cur.boost!=null?cur.boost:null,hol:cur.hol!=null?cur.hol:null};
 if(!Number.isFinite(row.st)&&!Number.isFinite(row.sh))return;
 live.push(row);
 if(live.length>10000)live.splice(0,live.length-10000);
 dbSet('live',live);$('liveCount').textContent=live.length;
 if(source==='live')render();
}

/* Scrutation : pas de chevauchement, arrêt dès que la connexion tombe */
async function poll(force=false){
 if(polling||!connected()||download.on||(manualCommandPending&&!force))return;
 polling=true;
 try{for(const r of [3,6,7]){if(!connected()||download.on)break;const ok=await send(r,0);if(!ok)break}}
 finally{polling=false}
}
function startPolling(){
 clearInterval(pollTimer);clearInterval(snapTimer);
 poll();
 pollTimer=setInterval(()=>poll(),12000);
 setTimeout(takeSnapshot,15000);
 snapTimer=setInterval(takeSnapshot,300000);
}
function cleanupConnection(){clearInterval(pollTimer);clearInterval(snapTimer);chC=null;chT=null}
function onDisconnect(){
 cleanupConnection();setStatus('Déconnecté.');
 if(!manualDisconnect&&dev){setStatus('Connexion perdue, tentative de reconnexion…');clearTimeout(reconnectTimer);reconnectTimer=setTimeout(reconnect,4000)}
}
async function connectCharacteristics(server){
 const serviceC=await server.getPrimaryService(SVC_C);
 chC=await serviceC.getCharacteristic(CH_C);
 const serviceT=await server.getPrimaryService(SVC_T);
 chT=await serviceT.getCharacteristic(CH_T);
 await chT.startNotifications();chT.removeEventListener('characteristicvaluechanged',onNotification);chT.addEventListener('characteristicvaluechanged',onNotification);
 try{await chC.startNotifications();chC.removeEventListener('characteristicvaluechanged',onNotification);chC.addEventListener('characteristicvaluechanged',onNotification)}catch(e){log('Notifications canal commande non disponibles : '+e.message)}
}
async function connectBLE(){
 manualDisconnect=false;clearTimeout(reconnectTimer);showError('');
 if(!navigator.bluetooth){showError('Web Bluetooth indisponible. Utilise Chrome sur Android ou un navigateur compatible, en HTTPS.');return}
 try{
  dev=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[SVC_C,SVC_T]});
  dev.removeEventListener('gattserverdisconnected',onDisconnect);dev.addEventListener('gattserverdisconnected',onDisconnect);
  setStatus('Connexion à '+(dev.name||'la VMI')+'…');
  const server=await dev.gatt.connect();await connectCharacteristics(server);
  setStatus('Connecté à '+(dev.name||'la VMI')+'.',true);startPolling();
  autoDone=false;setTimeout(autoHistory,3000);
 }catch(e){showError(e);setStatus('Connexion impossible.')}
}
async function reconnect(){
 if(manualDisconnect||!dev)return;
 try{const server=await dev.gatt.connect();await connectCharacteristics(server);setStatus('Reconnecté à '+(dev.name||'la VMI')+'.',true);startPolling()}
 catch(e){log('Reconnexion échouée : '+e.message);clearTimeout(reconnectTimer);reconnectTimer=setTimeout(reconnect,7000)}
}
$('conn').onclick=connectBLE;
$('disc').onclick=()=>{manualDisconnect=true;clearTimeout(reconnectTimer);cleanupConnection();if(dev&&dev.gatt&&dev.gatt.connected)dev.gatt.disconnect();setStatus('Déconnexion demandée.')};

/* Boutons de commande : une commande à la fois, avec vérification de l'état renvoyé par la VMI */
const EXPECT={24:v=>['vit',v+1,'Vitesse '+(v+1)],25:v=>['boost',v,'Boost '+(v?'activé':'arrêté')],26:v=>['hol',v,'Mode vacances '+(v?'activé':'arrêté')]};
document.querySelectorAll('[data-r]').forEach(b=>b.addEventListener('click',async()=>{
 if(manualCommandPending||download.on)return;
 if(!connected()){showError('VMI non connectée.');$('cmdResult').textContent='';return}
 manualCommandPending=true;
 const controls=[...document.querySelectorAll('[data-r]')];
 controls.forEach(x=>x.disabled=true);
 showError('');
 const reg=Number(b.dataset.r),value=Number(b.dataset.v),[key,expected,label]=EXPECT[reg](value);
 const result=$('cmdResult');
 try{
  result.textContent='Envoi de la commande à la VMI…';
  const t0=Date.now();
  const sent=await send(reg,value);
  if(!sent){result.textContent='La commande n’a pas pu être envoyée (voir le journal Bluetooth).';return}
  result.textContent='Commande envoyée, vérification de l’état…';
  for(let i=0;i<10&&!((lastSeen.state||0)>t0);i++)await sleep(200);
  if(!((lastSeen.state||0)>t0)){await send(3,0);for(let i=0;i<10&&!((lastSeen.state||0)>t0);i++)await sleep(200)}
  if((lastSeen.state||0)>t0&&cur[key]===expected)result.textContent='✓ Confirmé par la VMI : '+label+'.';
  else if((lastSeen.state||0)>t0)result.textContent='⚠ La VMI a répondu mais l’état affiché n’est pas '+label.toLowerCase()+'. Vérifie sur la VMI ou dans VMI+.';
  else result.textContent='⚠ Commande envoyée mais aucune réponse de la VMI : l’état n’a pas pu être vérifié.';
  poll(true);
 }catch(e){
  showError(e);result.textContent='Erreur pendant la commande.';
 }finally{
  manualCommandPending=false;controls.forEach(x=>x.disabled=false);
 }
}));
const setCommandsDisabled=dis=>document.querySelectorAll('[data-r]').forEach(x=>x.disabled=dis);
$('clk').onclick=setClock;

/* ---------- Dates ----------
   - l'export tableur inverse jour et mois dans les cellules de type date (jour ≤ 12) ;
   - surtout, la VMI date parfois ses relevés avec une horloge fausse (par ex. avril 2018) pendant des périodes
     entières. Son compteur « jours de fonctionnement » reste juste : on s'en sert pour retrouver la vraie date. */
const dayNo=dayNumber;
const modeOf=a=>{const m=new Map();let best,bc=0;for(const x of a){const c=(m.get(x)||0)+1;m.set(x,c);if(c>bc){bc=c;best=x}}return best};
/* Corrige en place les relevés datés d'avant 2025. Retourne {fixed, kept}. */
function fixClock(recs){
 const known=hist.concat(recs).filter(r=>r.t>=MIN_VALID&&Number.isFinite(r.d)&&new Date(r.t).getHours()>=10);
 const E0=modeOf(known.map(r=>dayNo(r.t)-r.d));
 const bad=recs.filter(r=>r.t<MIN_VALID).sort((a,b)=>a.t-b.t);
 let fixed=0;
 if(E0!==undefined&&bad.length){
  const eps=[];let cur=[];
  for(const r of bad){if(cur.length&&r.t-cur[cur.length-1].t>3*DAY){eps.push(cur);cur=[]}cur.push(r)}
  if(cur.length)eps.push(cur);
  for(const ep of eps){
   const k=modeOf(ep.filter(r=>Number.isFinite(r.d)&&new Date(r.t).getHours()>=10).map(r=>E0+r.d-dayNo(r.t)));
   if(k===undefined)continue;
   for(const r of ep){const x=new Date(r.t);r.t=new Date(x.getFullYear(),x.getMonth(),x.getDate()+k,x.getHours(),x.getMinutes(),x.getSeconds()).getTime();r.fixed=true;fixed++}
  }
 }
 return {fixed,kept:recs.filter(r=>r.t>=MIN_VALID)};
}
function ingest(recs,label){
 const {fixed,kept}=fixClock(recs);
 const map=new Map(hist.map(r=>[r.t,r]));
 kept.forEach(r=>map.set(r.t,r));
 hist=[...map.values()].sort((a,b)=>a.t-b.t);
 pruneHist();dbSet('hist',hist);source='hist';selectedDate=null;$('dayPicker').value='';
 const lost=recs.length-kept.length;
 $('importInfo').textContent=`${label} : ${recs.length} relevés lus${fixed?`, dont ${fixed} dont la date a été corrigée (horloge de la VMI fausse)`:''}${lost?`, ${lost} ignorés (date invalide impossible à corriger)`:''}.`;
 log($('importInfo').textContent);
 render();
}

/* Téléchargement de l'historique : on s'arrête au premier relevé déjà connu, puis on coupe la connexion
   pour interrompre le flux de la VMI (elle ne sait pas s'arrêter seule). */
const sigOf=r=>r.rk+'|'+r.d;
function parseDownloadLine(line){
 if(!download.on||!/^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2};/.test(line))return;
 const f=line.split(';'),p=parseCell(f[0]);if(!p)return;
 if(download.sigs.size&&download.sigs.has(p.rk+'|'+num(f[11]))){finishDownload(true);return}
 const rec=recFrom(f);if(rec)download.rows.push(rec);
}
function armTimer(){armDownloadTimeout(download,finishDownload)}
function finishDownload(reachedCut,timeout=false){
 if(!download.on)return;
 download.on=false;clearTimeout(download.timeout);
 const count=download.rows.length;
 if(count)ingest(download.rows,'Téléchargement');
 if(download.got){meta.lastSync=Date.now();dbSet('meta',meta);renderFreshness()}
 $('dlh').disabled=false;setCommandsDisabled(false);
 $('dlp').textContent=`Terminé : ${count} nouvelles lignes${reachedCut?' · historique à jour':timeout?(download.got?' · arrêt après une pause de 20 s':' · aucune réponse de la VMI'):(download.sigs.size?' · attention : trou possible avant la dernière ligne mémorisée':' · historique complet')}`;
 if(reachedCut&&dev&&dev.gatt&&dev.gatt.connected)dev.gatt.disconnect();
}
async function startDownload(auto=false){
 if(!chC){if(!auto)showError('Connecte-toi d’abord à la VMI.');return}
 if(download.on)return;
 showError('');dlFrames=0;
 download={on:true,rows:[],buf:'',total:0,sigs:new Set(hist.filter(r=>r.rk&&Number.isFinite(r.d)).map(sigOf)),got:false,lastPacket:Date.now(),timeout:null};
 $('dlh').disabled=true;setCommandsDisabled(true);
 $('dlp').textContent=auto?'Téléchargement automatique de l’historique…':'Démarrage du téléchargement…';
 const ok=await setClock();
 if(!ok){download.on=false;$('dlh').disabled=false;setCommandsDisabled(false);return}
 await send(0x2c,0);await send(0x20,0);await send(0x22,0);armTimer();
}
$('dlh').onclick=()=>startDownload(false);
function autoHistory(){
 if(autoDone||download.on||!connected())return;
 autoDone=true; /* une seule fois par connexion : pas de boucle déconnexion/reconnexion */
 startDownload(true).catch(e=>log('Téléchargement automatique impossible : '+(e.message||e)));
}

/* Import tableur */
const XLSX_URLS=['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js','https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'];
function loadScript(url,ms=15000){
 return new Promise((res,rej)=>{
  const sc=document.createElement('script');
  const t=setTimeout(()=>{sc.remove();rej(new Error('délai dépassé'))},ms);
  sc.src=url;sc.onload=()=>{clearTimeout(t);res()};sc.onerror=()=>{clearTimeout(t);sc.remove();rej(new Error('échec du chargement'))};
  document.head.appendChild(sc);
 });
}
let xlsxPromise=null;
function loadXLSX(){
 if(window.XLSX)return Promise.resolve();
 if(!xlsxPromise)xlsxPromise=(async()=>{
  for(const u of XLSX_URLS){try{await loadScript(u);if(window.XLSX)return}catch(e){log('SheetJS : '+e.message+' ('+u+')')}}
  throw new Error('Impossible de charger la bibliothèque Excel : l’import .xlsx demande une connexion internet (une seule fois). Le téléchargement par Bluetooth n’en a pas besoin.');
 })().catch(e=>{xlsxPromise=null;throw e});
 return xlsxPromise;
}
$('fx').onchange=async e=>{
 const file=e.target.files&&e.target.files[0];if(!file)return;showError('');
 try{
  $('importInfo').textContent='Chargement de la bibliothèque Excel…';
  await loadXLSX();
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
  const sheet=wb.Sheets[wb.SheetNames[0]];
  if(!sheet)throw new Error('Aucune feuille trouvée.');
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:''});
  const recs=[];for(let i=4;i<rows.length;i++){const r=recFrom(rows[i]);if(r)recs.push(r)}
  ingest(recs,'Import');
 }catch(err){showError('Import impossible : '+err.message)}
 e.target.value='';
};
$('clearImport').onclick=async()=>{if(confirm('Effacer tout l’historique importé ?')){hist=[];await dbSet('hist',[]);$('importInfo').textContent='';render()}};
$('histBtn').onclick=()=>{source='hist';render()};
$('liveBtn').onclick=()=>{source='live';render()};
$('dayPicker').onchange=e=>{selectedDate=e.target.value||null;render()};
$('prev').onclick=()=>{selectedDate=shiftDay(selectedDate,-1);$('dayPicker').value=selectedDate;render()};
$('next').onclick=()=>{selectedDate=shiftDay(selectedDate,1);$('dayPicker').value=selectedDate;render()};
document.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{daysSetting=Number(b.dataset.days);selectedDate=null;$('dayPicker').value='';render()});
$('clearLive').onclick=async()=>{if(confirm('Effacer les relevés en direct ?')){live=[];await dbSet('live',[]);$('liveCount').textContent='0';render()}};
$('csv').onclick=()=>{
 const keys=['t','st','sh','t1','h1','te','he','rpm','fil','vit','boost','hol'];
 const rows=[keys.join(';'),...live.map(r=>keys.map(k=>k==='t'?new Date(r.t).toISOString():(r[k]!=null?r[k]:'')).join(';'))];
 downloadText(rows.join('\n'),'vmi-purevent-live.csv','text/csv;charset=utf-8');
};
function downloadText(content,name,type,bom=true){
 const blob=new Blob(bom?['\ufeff',content]:[content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/* ---------- Export, sauvegarde et fraîcheur de l'historique ---------- */
const fmtLocal=t=>{const d=new Date(t);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`};
const fmtShort=t=>{const d=new Date(t);return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`};
const decFr=v=>(v==null||!Number.isFinite(v))?'':String(Math.round(v*100)/100).replace('.',',');
function histToCsv(rows){
 const head=['date_heure','salon_temp_C','salon_HR_pct','salon_HA_g_m3','salon_rosee_C','sonde1_temp_C','sonde1_HR_pct','air_entrant_temp_C','air_entrant_HR_pct','air_entrant_HA_g_m3','regime_tr_min','filtre_jours_usage','jours_fonctionnement'];
 const lines=[head.join(';')];
 for(const r of rows){
  const p=psychro({st:r.st,sh:r.sh,te:r.te,he:r.he});
  lines.push([fmtLocal(r.t),decFr(r.st),decFr(r.sh),decFr(p.haIn),decFr(p.dewIn),decFr(r.t1),decFr(r.h1),decFr(r.te),decFr(r.he),decFr(p.haOut),decFr(r.rpm),decFr(r.fil),decFr(r.d)].join(';'));
 }
 return lines.join('\r\n');
}
function makeBackup(){return {app:'vmi-purevent',version:1,exportedAt:new Date().toISOString(),hist,live,meta}}
function restoreBackup(obj){
 if(!obj||obj.app!=='vmi-purevent'||!Array.isArray(obj.hist))throw new Error('Fichier de sauvegarde non reconnu.');
 const map=new Map(hist.map(r=>[r.t,r]));let add=0;
 for(const r of obj.hist){if(r&&Number.isFinite(r.t)&&r.t>=MIN_VALID&&!map.has(r.t)){map.set(r.t,r);add++}}
 hist=[...map.values()].sort((a,b)=>a.t-b.t);
 let addL=0;
 if(Array.isArray(obj.live)){const seen=new Set(live.map(r=>r.t));for(const r of obj.live){if(r&&Number.isFinite(r.t)&&!seen.has(r.t)){live.push(r);seen.add(r.t);addL++}}live.sort((a,b)=>a.t-b.t);if(live.length>10000)live=live.slice(-10000)}
 pruneHist();dbSet('hist',hist);dbSet('live',live);
 if(obj.meta&&obj.meta.lastSync&&(!meta.lastSync||obj.meta.lastSync>meta.lastSync)){meta.lastSync=obj.meta.lastSync;dbSet('meta',meta)}
 return {add,addL};
}
$('expHist').onclick=()=>{
 const rows=hist.filter(r=>r.t>=MIN_VALID);
 if(!rows.length){$('backupInfo').textContent='Aucun historique à exporter.';return}
 downloadText(histToCsv(rows),`vmi-historique-${localDay()}.csv`,'text/csv;charset=utf-8');
 $('backupInfo').textContent=`${rows.length} relevés exportés (séparateur « ; », virgule décimale, prêt pour Excel).`;
};
$('expBackup').onclick=()=>{
 downloadText(JSON.stringify(makeBackup()),`vmi-sauvegarde-${localDay()}.json`,'application/json',false);
 $('backupInfo').textContent=`Sauvegarde créée : ${hist.length} relevés d’historique, ${live.length} relevés en direct.`;
};
$('restoreFile').onchange=async e=>{
 const file=e.target.files&&e.target.files[0];if(!file)return;
 try{
  const obj=JSON.parse(await file.text());
  const {add,addL}=restoreBackup(obj);
  $('backupInfo').textContent=`Sauvegarde restaurée : ${add} relevés d’historique et ${addL} relevés en direct ajoutés.`;
  render();
 }catch(err){$('backupInfo').textContent='Restauration impossible : '+err.message}
 e.target.value='';
};
/* La VMI ne garde que ~800 relevés : on estime sa capacité en jours d'après le rythme réel des relevés
   et on prévient avant que des relevés non téléchargés soient écrasés. */
function renderFreshness(){
 const box=$('fresh');
 const rows=hist.filter(r=>r.t>=MIN_VALID);
 if(!rows.length){box.className='advice';box.textContent='Aucun historique mémorisé. Connecte la VMI pour le télécharger : elle ne garde que ses 800 derniers relevés (environ 4 semaines).';return}
 const newest=rows[rows.length-1].t,age=(Date.now()-newest)/DAY;
 const spanDays=Math.max(1,Math.min(14,(newest-rows[0].t)/DAY));
 const perDay=rows.filter(r=>r.t>=newest-14*DAY).length/spanDays;
 const cap=perDay>0?Math.min(60,Math.max(7,800/perDay)):28;
 const left=cap-age;
 let cls='advice good';
 let msg=`Historique à jour jusqu’au ${fmtShort(newest)} (il y a ${age<1?Math.max(0,Math.round(age*24))+' h':age.toFixed(1)+' j'}). La VMI garde environ ${Math.round(cap)} jours de relevés : télécharge avant le ${fmtShort(newest+cap*DAY)}.`;
 if(left<=1){cls='advice warn';msg+=' ⚠ Des relevés ont peut-être déjà été écrasés : connecte-toi maintenant.'}
 else if(age>=14||left<7){cls='advice warn';msg+=' Pense à te connecter bientôt.'}
 if(meta.lastSync)msg+=` Dernière synchronisation : ${fmtShort(meta.lastSync)}.`;
 box.className=cls;box.textContent=msg;
}
setInterval(renderFreshness,60000);

/* ---------- Diagnostic ---------- */
function buildDiagnostic(){
 const L=[];
 const ago=t=>t?Math.round((Date.now()-t)/1000)+' s':'jamais';
 L.push(`VMI Purevent – diagnostic – version ${APP_VERSION} – ${new Date().toLocaleString('fr-FR')}`);
 L.push('Navigateur : '+navigator.userAgent);
 L.push(`Bluetooth : ${navigator.bluetooth?'disponible':'indisponible'} · connecté : ${connected()?'oui':'non'} · service worker : ${'serviceWorker' in navigator?(navigator.serviceWorker.controller?'actif':'non actif'):'absent'} · SheetJS : ${window.XLSX?'chargé':'non chargé'}`);
 const valid=hist.filter(r=>r.t>=MIN_VALID);
 L.push(`Historique : ${hist.length} relevés dont ${valid.length} valides`);
 if(valid.length){
  const ts=valid.map(r=>r.t);
  L.push(`  période : ${fmtLocal(ts[0])} → ${fmtLocal(ts[ts.length-1])}`);
  const gaps=[];for(let i=1;i<ts.length;i++)if(ts[i]-ts[i-1]>2*3600e3)gaps.push(`${fmtShort(ts[i-1])} → ${fmtShort(ts[i])} (${((ts[i]-ts[i-1])/3600e3).toFixed(1)} h)`);
  L.push(`  trous > 2 h : ${gaps.length}${gaps.length?' : '+gaps.slice(0,8).join(' ; '):''}`);
  const miss=k=>valid.filter(r=>r[k]==null).length;
  L.push(`  valeurs manquantes : salon T ${miss('st')}, salon HR ${miss('sh')}, sonde 1 T ${miss('t1')}, air entrant T ${miss('te')}, air entrant HR ${miss('he')}, régime ${miss('rpm')}`);
  L.push(`  relevés avec compteur de jours : ${valid.filter(r=>Number.isFinite(r.d)).length} · avec date brute : ${valid.filter(r=>r.rk).length}`);
 }
 L.push(`Direct : ${live.length} relevés${live.length?` (du ${fmtShort(live[0].t)} au ${fmtShort(live[live.length-1].t)})`:''}`);
 L.push(`Synchro : dernière ${meta.lastSync?fmtLocal(meta.lastSync):'jamais'} · mesures reçues : salon ${ago(lastSeen.salon)}, sondes ${ago(lastSeen.probes)}, état ${ago(lastSeen.state)}`);
 L.push(`Affichage : source ${source}, jour ${selectedDate||'aucun'}, période ${daysSetting?daysSetting+' j':'tout'}`);
 L.push('Graphiques : '+['chartRH','chartHA','chartTemp','chartRPM'].map(id=>`${id} ${(($(id).innerHTML.match(/<path/g))||[]).length} courbe(s)`).join(' · '));
 L.push('Téléchargement : '+(download.on?'en cours':'inactif')+` · ${$('dlp').textContent||'—'}`);
 L.push('Commandes : '+($('cmdResult').textContent||'—'));
 L.push('Erreurs : '+(errors.length?'\n  '+errors.join('\n  '):'aucune'));
 L.push('Journal (25 dernières lignes) :');
 logLines.slice(-25).forEach(x=>L.push('  '+x));
 return L.join('\n');
}
$('diagBtn').onclick=()=>{$('diagOut').textContent=buildDiagnostic()};
$('diagCopy').onclick=async()=>{
 const txt=buildDiagnostic();$('diagOut').textContent=txt;
 try{await navigator.clipboard.writeText(txt);showError('Diagnostic copié : colle-le dans la conversation.')}
 catch(e){showError('Copie impossible : sélectionne le texte du diagnostic puis copie-le à la main.')}
};

/* ---------- Graphiques SVG ---------- */
function selectedData(){
 const data=(source==='live'?live:hist).filter(r=>r.t>=MIN_VALID).sort((a,b)=>a.t-b.t);
 if(selectedDate){const start=dayStart(selectedDate),end=start+86400000;return data.filter(r=>r.t>=start&&r.t<end)}
 if(daysSetting&&data.length){const end=data[data.length-1].t;return data.filter(r=>r.t>=end-daysSetting*86400000)}
 return data;
}
/* Comparaison prudente par vitesse (médianes) */
function analyzeSpeeds(data){
 const min=Number($('minSamples').value),target=Number($('targetRH').value);
 const rows=data.filter(r=>Number.isFinite(r.vit)&&r.vit>=1&&r.vit<=3&&Number.isFinite(r.sh)&&Number.isFinite(r.st));
 const groups=[1,2,3].map(v=>{
  const a=rows.filter(r=>r.vit===v);
  return {v,n:a.length,rh:median(a.map(r=>r.sh)),ha:median(a.map(r=>absoluteHumidity(r.st,r.sh))),delta:median(a.map(r=>{const x=absoluteHumidity(r.st,r.sh),y=absoluteHumidity(r.te,r.he);return x!=null&&y!=null?x-y:null}))};
 });
 let html='<table><thead><tr><th>Vitesse</th><th>Relevés</th><th>HR médiane</th><th>HA salon</th><th>Écart HA</th></tr></thead><tbody>';
 for(const g of groups)html+=`<tr><td>${g.v}</td><td>${g.n}</td><td>${g.rh==null?'–':fmt(g.rh)+' %'}</td><td>${g.ha==null?'–':fmt(g.ha)+' g/m³'}</td><td>${g.delta==null?'–':fmt(g.delta)+' g/m³'}</td></tr>`;
 html+='</tbody></table>';
 const sufficient=groups.filter(g=>g.n>=min);
 let advice='';
 if(!rows.length)advice='Aucun relevé de la période ne contient la vitesse : seuls les relevés de l\'enregistrement en direct l\'enregistrent. Choisis la source « En direct » une fois que quelques relevés ont été pris.';
 else if(!sufficient.length)advice=`Il faut au moins ${min} relevés avec la vitesse identifiée pour chaque comparaison. Continue l'enregistrement en direct.`;
 else{
  const best=sufficient.filter(g=>g.rh!=null&&g.rh<=target).sort((a,b)=>a.v-b.v)[0];
  if(best)advice=`Parmi les vitesses disposant d'au moins ${min} relevés, la vitesse ${best.v} est la plus basse dont l'humidité relative médiane observée est inférieure ou égale à ${target} %. C'est une piste à vérifier sur des périodes comparables, pas une preuve d'optimum.`;
  else advice=`Aucune vitesse suffisamment documentée ne présente une humidité relative médiane inférieure ou égale à ${target} %. Vérifie aussi les sources d'humidité et la représentativité des périodes.`;
 }
 $('speedAnalysis').innerHTML=html+`<div class="advice">${advice}</div>`;
}
function renderRecommendation(data){
 const box=$('recommendation');
 const valid=data.filter(r=>Number.isFinite(r.st)&&Number.isFinite(r.sh)&&Number.isFinite(r.te)&&Number.isFinite(r.he));
 box.className='advice';
 if(!valid.length){box.textContent='Pas assez de données valides. Connecte la VMI et laisse-la enregistrer plusieurs relevés, ou importe un historique.';return}
 const recent=valid.slice(-Math.min(24,valid.length));
 const rh=median(recent.map(r=>r.sh)),ha=median(recent.map(r=>absoluteHumidity(r.st,r.sh))),haIn=median(recent.map(r=>absoluteHumidity(r.te,r.he)));
 const target=Number($('targetRH').value),delta=ha-haIn;
 let msg=`Sur les ${recent.length} derniers relevés exploitables : humidité relative médiane du salon ${fmt(rh)} %, humidité absolue du salon ${fmt(ha)} g/m³. `;
 if(rh>target+5)msg+=`L'humidité est au-dessus de ton objectif de ${target} %. Vérifie d'abord les sources de vapeur d'eau, les entrées d'air, les bouches d'extraction et l'état du filtre. `;
 else if(rh<target-5)msg+=`L'humidité est sous ton objectif de ${target} %. Il n'y a pas d'indice hygrométrique justifiant à lui seul d'augmenter la ventilation. `;
 else msg+=`L'humidité est proche de ton objectif de ${target} %. `;
 if(Number.isFinite(delta)){
  if(delta>1)msg+=`L'air entrant est actuellement plus sec en humidité absolue d'environ ${fmt(delta)} g/m³ : le renouvellement d'air a un potentiel d'assèchement.`;
  else if(delta< -1)msg+=`L'air entrant est actuellement plus humide en valeur absolue d'environ ${fmt(Math.abs(delta))} g/m³ : augmenter la vitesse ne garantit pas d'assécher le logement.`;
  else msg+="L'air entrant et l'air intérieur ont des humidités absolues proches.";
 }
 box.textContent=msg;
}
function render(){
 const data=selectedData();
 $('liveCount').textContent=live.length;
 $('historyStatus').textContent=`${data.length} relevés affichés · ${source==='live'?'enregistrement local en direct':'historique importé / VMI'} · ${selectedDate?'jour '+selectedDate:(daysSetting?daysSetting+' derniers jours':'toute la période')}`;
 const lastRpm=[...hist].reverse().find(r=>Number.isFinite(r.rpm));
 $('rpm').textContent=lastRpm?lastRpm.rpm:'–';
 renderCharts(data,selectedDate,$);renderRecommendation(data);analyzeSpeeds(data);renderFreshness();
}
$('targetRH').onchange=render;$('minSamples').onchange=render;

setInterval(()=>{if(cur.sal_t!==undefined)updateLiveMetrics()},5000);
$('copyLog').onclick=()=>navigator.clipboard.writeText(logLines.join('\n')).then(()=>showError('Journal copié.'),showError);
$('clearLog').onclick=()=>{logLines=[];$('log').textContent=''};
$('themeBtn').onclick=()=>{
 const root=document.documentElement;
 const dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
 root.dataset.theme=dark?'light':'dark';
 try{localStorage.setItem('vmi_theme',root.dataset.theme)}catch(e){}
};
try{const theme=localStorage.getItem('vmi_theme');if(theme)document.documentElement.dataset.theme=theme}catch(e){}
if(!navigator.bluetooth)showError('Web Bluetooth indisponible : ouvre cette page en HTTPS dans Chrome sur Android.');
init();
