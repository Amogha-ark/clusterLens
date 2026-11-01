import { describe, expect, it } from 'vitest';
import { forecast } from './forecast';
import { readInvestigation, writeInvestigation } from './investigation';
const now=Date.parse('2026-11-01T12:00:00Z');
function history(hours=12,slope=.1){return Array.from({length:hours*240+1},(_,i)=>({uid:'w',timestamp:new Date(now-hours*3600000+i*15000).toISOString(),cpu:2+slope*i/240,memory:1000+i}));}
describe('bounded telemetry forecasts',()=>{
 it('supports a five-minute preview after ten minutes with finer buckets',()=>{
   const result=forecast(history(1/6),'w','cpu',1/12,now);
   expect(result.reason).toBe('');
   expect(result.projected.at(-1)!.time).toBe(now+300000);
   expect(result.projected.at(-1)!.value).toBeCloseTo(2.025,5);
   expect(forecast(history(1/12),'w','cpu',1/12,now).reason).toContain('10 minutes');
 });
 it('uses recent history and tighter gap gates for short forecasts',()=>{
   const result=forecast(history(12),'w','cpu',1/12,now);
   expect(result.spanHours).toBeCloseTo(.5);
   const gap=history(1).filter((_,i)=>i<150||i>160);
   expect(forecast(gap,'w','cpu',1/4,now).reason).toContain('gap');
   expect(forecast(history(.5),'w','cpu',.5,now).reason).toContain('60 minutes');
 });
 it('recovers a known linear trend and returns nonnegative finite bounds',()=>{
   const result=forecast(history(),'w','cpu',6,now);
   expect(result.reason).toBe('');expect(result.projected).toHaveLength(37);
   expect(result.projected.at(-1)!.value).toBeCloseTo(3.8,5);
   expect(result.projected.every(p=>p.low>=0 && p.low<=p.value && p.high>=p.value)).toBe(true);
 });
 it('requires progressively more history for longer horizons',()=>{
   expect(forecast(history(2),'w','cpu',1,now).reason).toBe('');
   expect(forecast(history(2),'w','cpu',3,now).reason).toContain('6 hours');
   expect(forecast([],'w','cpu',1,now).projected).toEqual([]);
 });
 it('rejects stale, sparse and large-gap history',()=>{
   expect(forecast(history(),'w','cpu',1,now+120000).reason).toContain('stale');
   expect(forecast(history().filter((_,i)=>i%100===0),'w','cpu',1,now).projected).toEqual([]);
   expect(forecast(history().filter((_,i)=>i<500 || i>600),'w','cpu',1,now).reason).toContain('gap');
 });
 it('isolates UID, deduplicates timestamps and rejects invalid values',()=>{
   const data=history(2);const result=forecast([...data,...data,{...data[0],uid:'other',cpu:999},{...data[0],timestamp:'bad',cpu:NaN}],'w','cpu',1,now);
   expect(result.samples).toBe(data.length);expect(result.projected.at(-1)!.value).toBeCloseTo(2.3,5);
 });
 it('adds uncertainty for noisy data and clips negative forecasts',()=>{
   const noisy=history().map((p,i)=>({...p,cpu:p.cpu+Math.sin(i/30)*.1}));
   const result=forecast(noisy,'w','cpu',3,now);
   expect(result.residual).toBeGreaterThan(0);expect(result.projected.at(-1)!.high-result.projected.at(-1)!.low).toBeGreaterThan(result.projected[0].high-result.projected[0].low);
   expect(forecast(history(12,-.15),'w','cpu',6,now).projected.at(-1)!.value).toBe(0);
 });
 it('supports bookmarked Forecasts routes and rejects unknown horizons',()=>{
   const route=readInvestigation('#view=Forecasts&namespace=lab&range=3600');
   expect(readInvestigation(writeInvestigation(route))).toEqual(route);
   expect(route.view).toBe('Forecasts');expect(forecast(history(),'w','cpu',99,now).projected).toEqual([]);
 });
});
