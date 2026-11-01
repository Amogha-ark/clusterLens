// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HealthOverview } from './HealthOverview';
import { attentionItems, currentNodeUsage } from './health';
import type { Resource, Snapshot } from './types';
afterEach(cleanup);
const now = new Date().toISOString();
function resource(p: Partial<Resource> = {}): Resource {
  return {uid:'w',kind:'Deployment',name:'api',namespace:'lab',created:now,labels:{},ownerUid:'',workloadUid:'',status:'Healthy',ready:1,desired:1,restarts:0,node:'',containers:[],related:[],usage:null,cpuCapacity:0,memoryCapacity:0,cpuAllocatable:0,memoryAllocatable:0,capacity:0,storageClass:'',volume:'',accessModes:[],conditions:[],...p};
}
const node = resource({uid:'n',kind:'Node',name:'node',namespace:'',status:'Ready',usage:{cpu:0.21,memory:1610612736,timestamp:now}});
function snapshot(resources: Resource[]): Snapshot {
  return {cluster:'lab',timestamp:now,connected:true,connectionError:'',sources:[{kind:'Node',synced:true,error:''}],metrics:{available:true,error:'',lastSuccess:now},resources:[node,...resources],deletedResources:[],events:[],truncated:false,historyDropped:0};
}
describe('health overview',()=>{
  it('groups failing pods by workload ownership without merging shared-node workloads',()=>{
    const a=resource({uid:'a',name:'a',ready:0,status:'Degraded'});
    const b=resource({uid:'b',name:'b',desired:3,ready:2,status:'Degraded'});
    const rs=resource({uid:'rs',kind:'ReplicaSet',ownerUid:'a'});
    const pods=[1,2,3].map(i=>resource({uid:`p${i}`,kind:'Pod',ownerUid:'rs',workloadUid:'a',ready:0,status:'CrashLoopBackOff',node:'shared'}));
    const result=attentionItems([a,b,rs,...pods]);
    expect(result.map(i=>i.resource.uid)).toEqual(['a','b']);
    expect(result[0].symptoms).toBe('3 pods: CrashLoopBackOff');
    expect(result[0].category).toBe('No ready replicas');
  });
  it('keeps completed jobs, scaled-down workloads and unknown states out of failure counts',()=>{
    expect(attentionItems([resource({status:'Scaled to zero',desired:0,ready:0}),resource({uid:'j',kind:'Job',status:'Completed'}),resource({uid:'u',status:'Unknown'})])).toEqual([]);
  });
  it('rejects stale or disconnected usage and exposes partial coverage',()=>{
    const s=snapshot([resource({uid:'n2',kind:'Node',status:'Ready'})]);
    expect(currentNodeUsage(s)).toMatchObject({count:1,total:2,cpu:0.21});
    expect(currentNodeUsage({...s,connected:false}).count).toBe(0);
    expect(currentNodeUsage(s,'network error').count).toBe(0);
    expect(currentNodeUsage({...s,timestamp:'invalid'}).count).toBe(0);
    expect(currentNodeUsage({...s,timestamp:new Date(Date.now()+1000).toISOString()},'',Date.now()+100000).count).toBe(0);
    const old={...node,usage:{...node.usage!,timestamp:'2020-01-01T00:00:00Z'}};
    expect(currentNodeUsage({...s,resources:[old]}).count).toBe(0);
  });
  it('shows a bounded queue, searches all entries and opens the exact selected UID',()=>{
    const resources=Array.from({length:8},(_,i)=>resource({uid:`w${i}`,name:`api-${i}`,status:'Degraded',ready:0}));
    const open=vi.fn();
    render(<HealthOverview snapshot={snapshot(resources)} error="" onOpen={open} onNavigate={vi.fn()}/>);
    expect(screen.getAllByRole('button',{name:/Investigate /})).toHaveLength(5);
    fireEvent.click(screen.getByRole('button',{name:'View all 8 resources'}));
    fireEvent.change(screen.getByRole('textbox',{name:'Find a resource'}),{target:{value:'api-7'}});
    fireEvent.click(screen.getByRole('button',{name:'Investigate api-7'}));
    expect(open).toHaveBeenCalledWith(resources[7]);
  });
  it('keeps unknown states distinct and never gives a green verdict to stale data',()=>{
    const s=snapshot([resource({status:'Unknown'})]);
    render(<HealthOverview snapshot={{...s,connected:false}} error="" onOpen={vi.fn()} onNavigate={vi.fn()}/>);
    expect(screen.getByText('Your cluster’s health is unclear.')).toBeTruthy();
    expect(screen.getByText('Current measurements unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Unknown · 1'}));
    expect(screen.getByRole('button',{name:'Investigate api'})).toBeTruthy();
  });
  it('shows measured values and bound-claim context when healthy',()=>{
    const navigate=vi.fn();
    render(<HealthOverview snapshot={snapshot([resource(),resource({uid:'c',kind:'PersistentVolumeClaim',status:'Bound'})])} error="" onOpen={vi.fn()} onNavigate={navigate}/>);
    expect(screen.getByText('Your cluster looks healthy.')).toBeTruthy();
    expect(screen.getByText('0.21')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/1 of 1 claims bound/}));
    expect(navigate).toHaveBeenCalledWith('Storage');
    expect(screen.queryByRole('table')).toBeNull();
  });
});
