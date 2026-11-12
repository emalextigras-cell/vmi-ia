/** Calculs hygrométriques, approximation de Magnus. Valeurs hors plage rejetées. */
export function validTemp(v){return Number.isFinite(v)&&v>-40&&v<80}
export function validHumidity(v){return Number.isFinite(v)&&v>=0&&v<=100}
export function saturationVaporPressure(temp){
 if(!validTemp(temp))return null;
 return 6.112*Math.exp((17.62*temp)/(243.12+temp));
}
export function absoluteHumidity(temp,rh){
 if(!validTemp(temp)||!validHumidity(rh))return null;
 const es=saturationVaporPressure(temp);
 if(!Number.isFinite(es))return null;
 const e=(rh/100)*es;
 const result=216.7*e/(temp+273.15);
 return Number.isFinite(result)?result:null;
}
export function dewPoint(temp,rh){
 if(!validTemp(temp)||!validHumidity(rh)||rh===0)return null;
 const a=17.62,b=243.12;
 const g=Math.log(rh/100)+(a*temp)/(b+temp);
 const denominator=a-g;
 if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-9)return null;
 const result=b*g/denominator;
 return Number.isFinite(result)?result:null;
}
export function psychro(r){
 return {
  haIn:absoluteHumidity(r.st,r.sh),
  haOut:absoluteHumidity(r.te,r.he),
  dewIn:dewPoint(r.st,r.sh),
  dewOut:dewPoint(r.te,r.he)
 };
}
