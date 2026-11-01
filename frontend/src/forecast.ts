import type { Point } from './types';

export type ForecastPoint = { time: number; value: number; low: number; high: number };
export type Forecast = { observed: {time:number;value:number}[]; projected: ForecastPoint[]; reason: string; coverage: number; spanHours: number; samples: number; residual: number };
export const forecastHorizons = [1/12, 1/4, 1/2, 1, 3, 6];
export const horizonLabel = (hours: number) => hours < 1 ? `${Math.round(hours*60)}m` : `${hours}h`;
export function forecastSettings(horizon: number) {
  const short = horizon < 1;
  return { short, minimumHours: 2*horizon, bucketMs: short ? 30000 : 300000,
    gapMinutes: short ? 2 : 15, lookbackHours: short ? Math.max(.5,4*horizon) : 24 };
}

// A descriptive linear extrapolation, not a calibrated probabilistic forecast.
// Equal-weight five-minute means prevent dense collection bursts dominating the fit.
export function forecast(points: Point[], uid: string, field: 'cpu'|'memory', horizon: number, now=Date.now()): Forecast {
  const settings=forecastSettings(horizon);
  const bucketMs=settings.bucketMs;
  const unique = new Map<number,number>();
  for (const p of points) {
    const t=Date.parse(p.timestamp), value=p[field];
    if(p.uid===uid && Number.isFinite(t) && t<=now && t>=now-settings.lookbackHours*3600000 && Number.isFinite(value) && value>=0) unique.set(t,value);
  }
  const observed=[...unique].sort((a,b)=>a[0]-b[0]).map(([time,value])=>({time,value}));
  const out:Forecast={observed,projected:[],reason:'',coverage:0,spanHours:0,samples:observed.length,residual:0};
  const fail=(reason:string)=>({...out,projected:[],reason});
  if (!forecastHorizons.includes(horizon)) return fail('Unsupported forecast horizon.');
  const required=settings.short ? `${Math.round(settings.minimumHours*60)} minutes` : `${settings.minimumHours} hours`;
  if(observed.length<2) return fail(`Waiting for measurements. At least ${required} of usable history are required.`);
  const first=observed[0].time,last=observed.at(-1)!.time;
  out.spanHours=(last-first)/3600000;
  const buckets=new Map<number,{sum:number;time:number;count:number}>();
  for(const p of observed){const key=Math.floor((p.time-first)/bucketMs);const b=buckets.get(key)||{sum:0,time:0,count:0};b.sum+=p.value;b.time+=p.time;b.count++;buckets.set(key,b);}
  out.coverage=buckets.size/(Math.floor((last-first)/bucketMs)+1);
  if(now-last>90000) return fail('The latest measurement is stale. Fresh telemetry is required for a projection.');
  if(out.spanHours+1/3600<settings.minimumHours) return fail(`This ${horizonLabel(horizon)} projection requires at least ${required} of history; ${settings.short ? `${(out.spanHours*60).toFixed(1)} minutes` : `${out.spanHours.toFixed(1)} hours`} are available.`);
  if(out.coverage<0.8) return fail(`Fewer than 80% of ${settings.short?'30-second':'five-minute'} intervals contain measurements.`);
  if(observed.some((p,i)=>i>0 && p.time-observed[i-1].time>settings.gapMinutes*60000)) return fail(`History contains a gap longer than ${settings.gapMinutes} minutes. A continuous recent history is required.`);
  const data=[...buckets.values()].map(b=>({x:(b.time/b.count-last)/3600000,y:b.sum/b.count}));
  const mx=data.reduce((s,p)=>s+p.x,0)/data.length,my=data.reduce((s,p)=>s+p.y,0)/data.length;
  const xx=data.reduce((s,p)=>s+(p.x-mx)**2,0);
  if(!xx) return fail('Not enough distinct measurement intervals.');
  const slope=data.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/xx;
  const intercept=my-slope*mx;
  const rms=Math.sqrt(data.reduce((s,p)=>s+(p.y-(intercept+slope*p.x))**2,0)/Math.max(1,data.length-2));
  out.residual=rms;
  if(my>0 && rms/my>0.5) return fail('Recent usage is too variable for this simple trend model.');
  // The envelope includes fit residuals and the latest departure from the fitted trend.
  // Its widening is a heuristic; it does not imply 95% coverage or failure likelihood.
  const spread=Math.max(2*rms,Math.abs(observed.at(-1)!.value-intercept));
  out.projected=Array.from({length:37},(_,i)=>{
    const h=horizon*i/36, value=Math.max(0,intercept+slope*h), margin=spread*(1+h/out.spanHours);
    return {time:last+h*3600000,value,low:Math.max(0,value-margin),high:value+margin};
  });
  if(out.projected.some(p=>![p.value,p.low,p.high].every(Number.isFinite))) return fail('The trend exceeds the supported numeric range.');
  return out;
}
