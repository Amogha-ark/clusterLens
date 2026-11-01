// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Forecasts } from './Forecasts';
import type { Snapshot } from './types';
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
const snapshot=():Snapshot=>({cluster:'test',connected:true,connectionError:'',timestamp:new Date().toISOString(),sources:[{kind:'Node',synced:true,error:''}],metrics:{available:true,error:'',lastSuccess:new Date().toISOString()},resources:[],deletedResources:[],events:[],truncated:false,historyDropped:0});
it('loads a 24h history and explains a longer horizon with insufficient data',async()=>{
 const now=Date.now();const points=Array.from({length:500},(_,i)=>({uid:'cluster',timestamp:new Date(now-(499-i)*15000).toISOString(),cpu:1+i*.001,memory:1000000+i*100}));
 const fetcher=vi.fn(async(_url:string)=>({ok:true,json:async()=>({points})}));vi.stubGlobal('fetch',fetcher);
 render(<Forecasts snapshot={snapshot()} namespace="all" error="" onOpen={vi.fn()}/>);
 await screen.findByText('Assuming the recent trend continues');
 expect(screen.getByRole('button',{name:'Next 5m'}).getAttribute('aria-pressed')).toBe('true');
 expect(screen.getByText(/Short-interval preview/)).toBeTruthy();
 expect(String(fetcher.mock.calls[0][0])).toContain('uid=cluster');
 fireEvent.click(screen.getByRole('button',{name:'Next 6h'}));
 await screen.findByText(/requires at least 12 hours/);
 expect(screen.queryByRole('slider')).toBeNull();
});
it('does not project while disconnected or when the history request fails',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));
 render(<Forecasts snapshot={{...snapshot(),connected:false}} namespace="all" error="" onOpen={vi.fn()}/>);
 expect(await screen.findByText(/Current discovery or metrics are incomplete/)).toBeTruthy();
 expect(screen.queryByText('Assuming the recent trend continues')).toBeNull();
});
