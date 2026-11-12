/** Dates, constantes et normalisation des valeurs. */
export const DAY=864e5;
export const pad=n=>String(n).padStart(2,'0');
export const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
export const dayStart=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).getTime()};
export const shiftDay=(s,k)=>{const d=new Date(dayStart(s||localDay()));d.setDate(d.getDate()+k);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
export const fmt=v=>Number.isFinite(v)?v.toFixed(1):'–';
export const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v!=='string')return null;const n=parseFloat(v.trim().replace(',','.'));return Number.isFinite(n)?n:null};
export const MIN_VALID=new Date(2025,0,1).getTime();
export const HIST_MAX=100000;
