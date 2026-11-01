import { useEffect, useMemo, useState } from 'react';
import type { Point, Resource, Snapshot } from './types';
import { bytes } from './lib';
import { workloadRoots } from './insights';
import { forecast, forecastHorizons, forecastSettings, horizonLabel, type Forecast } from './forecast';
import './forecast.css';

function ForecastChart({result,field}:{result:Forecast;field:'cpu'|'memory'}) {
  const [index,setIndex]=useState(36);
  const format=(v:number)=>field==='cpu'?`${v.toFixed(3)} cores`:bytes(v,2);
  if(!result.observed.length) return <p className="forecast-empty">No measurements available for this resource.</p>;
  const width=760,height=290,left=65,right=740,top=20,bottom=245;
  const start=result.observed[0].time,end=result.projected.at(-1)?.time || result.observed.at(-1)!.time;
  const max=Math.max(...result.observed.map(p=>p.value),...result.projected.map(p=>p.high),field==='cpu'?0.01:1048576)*1.12;
  const x=(t:number)=>left+(t-start)/Math.max(1,end-start)*(right-left),y=(v:number)=>bottom-v/max*(bottom-top);
  // Preserve all collection gaps when drawing history; do not interpolate missing samples.
  const line=result.observed.map((p,i)=>`${i && p.time-result.observed[i-1].time<=45000?'L':'M'}${x(p.time)},${y(p.value)}`).join(' ');
  const path=(points:{time:number;value:number}[])=>points.map((p,i)=>`${i?'L':'M'}${x(p.time)},${y(p.value)}`).join(' ');
  const projected=result.projected;
  const band=projected.length?path(projected.map(p=>({time:p.time,value:p.high})))+' '+path([...projected].reverse().map(p=>({time:p.time,value:p.low}))).replace('M','L')+' Z':'';
  const active=projected[Math.min(index,projected.length-1)];
  return <>
    <div className="forecast-plot"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${field==='cpu'?'CPU':'Memory'} measurements and trend projection. Missing measurements leave gaps.`}>
      {[0,.5,1].map(f=><g key={f}><line x1={left} x2={right} y1={y(max*f)} y2={y(max*f)} className="forecast-grid"/><text x={left-9} y={y(max*f)+4} textAnchor="end">{field==='cpu'?(max*f).toFixed(2):bytes(max*f,0)}</text></g>)}
      <path d={band} className="forecast-band"/><path d={line} className="forecast-line"/><path d={path(projected)} className="forecast-line projected"/>
      <line x1={x(result.observed.at(-1)!.time)} x2={x(result.observed.at(-1)!.time)} y1={top} y2={bottom} className="forecast-now"/>
      <text x={left} y={273}>{new Date(start).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text><text x={right} y={273} textAnchor="end">{new Date(end).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</text>
      {active && <circle cx={x(active.time)} cy={y(active.value)} r="4" className="forecast-dot"/>}
    </svg></div>
    <div className="forecast-legend"><span>━ Observed</span><span>┄ Projected trend</span><span>▧ Uncertainty envelope</span><span>Vertical line: last measurement</span></div>
    {active && <><label className="forecast-inspect">Inspect projected time<input type="range" min="0" max={projected.length-1} value={Math.min(index,projected.length-1)} onChange={e=>setIndex(Number(e.target.value))}/></label><p className="forecast-reading" aria-live="polite">{new Date(active.time).toLocaleString()} · {format(active.value)} · envelope {format(active.low)}–{format(active.high)}</p></>}
  </>;
}

export function Forecasts({snapshot,namespace,error,onOpen}:{snapshot:Snapshot;namespace:string;error:string;onOpen:(r:Resource)=>void}) {
  const [selected,setSelected]=useState('cluster');
  const [horizon,setHorizon]=useState(1/12);
  const settings=forecastSettings(horizon);
  const [field,setField]=useState<'cpu'|'memory'>('memory');
  const [data,setData]=useState<{uid:string;points:Point[];error:string}|null>(null);
  const choices=useMemo(()=>[...snapshot.resources.filter(r=>r.kind==='Node'),...workloadRoots(snapshot.resources).filter(r=>namespace==='all'||r.namespace===namespace)], [snapshot.resources,namespace]);
  const uid=selected==='cluster'||choices.some(r=>r.uid===selected)?selected:'cluster';
  const resource=choices.find(r=>r.uid===uid);
  useEffect(()=>{
    const c=new AbortController();
    const timeout=setTimeout(()=>c.abort(),15000);
    let active=true;
    const query=new URLSearchParams({uid,since:new Date(Date.now()-86400000).toISOString()});
    fetch('/api/v1/history?'+query,{signal:c.signal}).then(async r=>{if(!r.ok)throw new Error('History request failed');const value=await r.json();if(!Array.isArray(value.points))throw new Error('History response is invalid');return value.points as Point[];}).then(points=>{if(active)setData({uid,points,error:''})}).catch(()=>{if(active)setData({uid,points:[],error:'History unavailable. Check the connection and try again after the next refresh.'})}).finally(()=>clearTimeout(timeout));
    return()=>{active=false;c.abort();clearTimeout(timeout)};
  },[uid,snapshot.timestamp]);
  const points=data?.uid===uid?data.points:[];
  const result=useMemo(()=>forecast(points,uid,field,horizon),[points,uid,field,horizon,snapshot.timestamp]);
  const snapshotAge=Date.now()-Date.parse(snapshot.timestamp);
  const unavailable=!!error || !snapshot.connected || !snapshot.metrics.available || !Number.isFinite(snapshotAge) || snapshotAge>30000 || snapshot.truncated || snapshot.sources.some(s=>!s.synced||s.error);
  const reason=unavailable?'Current discovery or metrics are incomplete. Projections resume when fresh, complete signals return.':data?.uid!==uid?'Loading available history…':data.error || result.reason;
  const display=reason?{...result,projected:[]}:result;
  const end=display.projected.at(-1);
  const format=(n:number)=>field==='cpu'?`${n.toFixed(3)} cores`:bytes(n,2);
  return <div className="forecast-page">
    <section className="forecast-toolbar"><label>Resource<select value={uid} onChange={e=>setSelected(e.target.value)}><option value="cluster">Cluster · all namespaces</option>{choices.map(r=><option key={r.uid} value={r.uid}>{r.kind} · {r.namespace?`${r.namespace}/`:''}{r.name}</option>)}</select></label><label>Signal<select value={field} onChange={e=>setField(e.target.value as 'cpu'|'memory')}><option value="memory">Memory</option><option value="cpu">CPU</option></select></label><div className="forecast-horizons" aria-label="Projection horizon">{forecastHorizons.map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>setHorizon(h)}>Next {horizonLabel(h)}</button>)}</div></section>
    <div className="forecast-layout"><section className="panel forecast-main"><h2>{resource?.name||'Cluster'} {field==='cpu'?'CPU':'memory'} forecast</h2><p className="forecast-subtitle">Uses up to {horizonLabel(settings.lookbackHours)} of available history · independent of the dashboard lookback</p><div className="forecast-values"><div><span>Last measurement</span><strong>{result.observed.length?format(result.observed.at(-1)!.value):'—'}</strong><small>{result.observed.length?new Date(result.observed.at(-1)!.time).toLocaleString():'No samples'}</small></div><div><span>Projected in {horizonLabel(horizon)}</span><strong>{end?format(end.value):'—'}</strong><small>{end?'Assuming the recent trend continues':'Projection unavailable'}</small></div></div>
      {settings.short && <p className="forecast-short-note">Short-interval preview · responsive to recent changes and less reliable for planning. Requires {Math.round(settings.minimumHours*60)} minutes of measured history.</p>}
      {reason && <p className="forecast-status" role="status">{reason}</p>}
      <ForecastChart key={`${uid}-${field}-${horizon}`} result={display} field={field}/>
      {resource && <button className="button" onClick={()=>onOpen(resource)}>Investigate this resource ↗</button>}
    </section><aside className="panel forecast-context"><h2>What supports this projection?</h2><dl><dt>Available history</dt><dd>{settings.short ? `${(result.spanHours*60).toFixed(1)} minutes` : `${result.spanHours.toFixed(1)} hours`}</dd><dt>Valid samples</dt><dd>{result.samples.toLocaleString()}</dd><dt>{settings.short?'30-second':'Five-minute'} intervals with data</dt><dd>{result.samples>1?`${(result.coverage*100).toFixed(0)}%`:'—'}</dd><dt>Global history evictions</dt><dd>{snapshot.historyDropped.toLocaleString()}</dd></dl><p>History is held in memory. The 60,000-point global cap can shorten the available window; backend restarts clear it.</p><details><summary>Method and uncertainty</summary><p>Linear regression of equally weighted {settings.short?'30-second':'five-minute'} means. A {horizonLabel(horizon)} forecast requires {horizonLabel(settings.minimumHours)} of history, at least 80% interval coverage, no gaps over {settings.gapMinutes} minutes, and a sample within 90 seconds.</p><p>The shaded envelope reflects twice the fit error or the latest deviation, whichever is larger, and widens with horizon. It is a heuristic range, not a calibrated confidence interval. Negative projections are clipped to zero.</p><p>Deployments, scaling, traffic shifts and resource membership changes can invalidate the trend. CPU and memory projections do not predict outages, OOM events or root cause.</p></details><p className="forecast-footnote">Computed locally from telemetry. No AI provider request is made.</p></aside></div>
  </div>;
}
