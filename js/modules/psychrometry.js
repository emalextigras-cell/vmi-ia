/** Calculs hygrométriques, approximation de Magnus. */
export function saturationVaporPressure(temp){return 6.112*Math.exp((17.62*temp)/(243.12+temp))}
export function absoluteHumidity(temp,rh){if(!Number.isFinite(temp)||!Number.isFinite(rh)||rh<0||rh>100||temp<=-80||temp>=80)return null;const e=(rh/100)*saturationVaporPressure(temp);return 216.7*e/(temp+273.15)}
export function dewPoint(temp,rh){if(!Number.isFinite(temp)||!Number.isFinite(rh)||rh<=0||rh>100)return null;const a=17.62,b=243.12,g=Math.log(rh/100)+(a*temp)/(b+temp);return b*g/(a-g)}
export function psychro(r){return {haIn:absoluteHumidity(r.st,r.sh),haOut:absoluteHumidity(r.te,r.he),dewIn:dewPoint(r.st,r.sh),dewOut:dewPoint(r.te,r.he)}}
export function validTemp(v){return Number.isFinite(v)&&v>-40&&v<80}
