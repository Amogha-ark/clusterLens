// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { AIExplanation } from "./AIExplanation";
import type { AIJob, AIResult } from "./aiInvestigation";
import type { Resource } from "./types";
const resource = {uid:"w",name:"api",kind:"Deployment"} as Resource;
const pack = {uid:"w",timestamp:new Date().toISOString(),range:900,since:new Date().toISOString(),limitations:["Metrics history is volatile"],items:[{id:"E1",resourceUid:"w",title:"Deployment api",data:{restarts:2}}]};
const result: AIResult = {provider:"ollama",model:"local",evidence:pack,explanation:{summary:"Two cumulative restarts",findings:[{text:"Observed restarts",evidenceIds:["E1"]}],nextChecks:[]}};
let cluster = "";
let sequence = 0;
beforeEach(() => {
 cluster="test-"+(++sequence);
 const values=new Map<string,string>();
 vi.stubGlobal("localStorage",{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});
});
afterEach(() => {cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
function setup(options: {enabled?: boolean; running?: boolean; fail?: boolean}={}) {
 let accepted=false;
 let job: AIJob={id:"job-1",cluster,uid:"w",range:900,state:options.running?"running":"completed",started:new Date().toISOString(),evidence:pack,...(!options.running?{result}: {})};
 const fetcher=vi.fn(async (url: string, init?: RequestInit) => {
  let data:unknown; let status=200;
  if (url.endsWith("/status")) data={enabled:options.enabled!==false,provider:"ollama",model:"local",endpoint:"http://localhost:11434"};
  else if (url.includes("/evidence?")) data=pack;
  else if (url.includes("/jobs?")) {data=accepted?job:{error:"Not found"};status=accepted?200:404;}
  else if (init?.method==="POST") {if(options.fail){status=502;data={error:"AI provider unavailable"};}else{accepted=true;data=job;status=202;}}
  else if (init?.method==="DELETE") {job={...job,state:"canceled"};data=job;}
  else data=job;
  return {ok:status<400,status,json:async()=>data};
 });
 vi.stubGlobal("fetch",fetcher);
 return {fetcher,complete:()=>{job={...job,state:"completed",result};},accept:()=>{accepted=true;}};
}
function view() {return render(<AIExplanation cluster={cluster} resource={resource} range={900} resources={[resource]} onOpen={vi.fn()}/>);}
async function start() {
 fireEvent.click(await screen.findByText("Review evidence for AI"));await screen.findByText(/Preview evidence/);
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByText("Explain this resource"));
}
describe("persistent AI investigations",()=>{
 it("stays disabled without a provider and never starts a model automatically",async()=>{
  const {fetcher}=setup({enabled:false});view();await screen.findByText(/AI is off/);
  expect(screen.queryByText("Review evidence for AI")).toBeNull();
  expect(fetcher.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
 });
 it("requires preview and consent, then shows cited evidence",async()=>{
  const {fetcher}=setup();const open=vi.fn();render(<AIExplanation cluster={cluster} resource={resource} range={900} resources={[resource]} onOpen={open}/>);
  fireEvent.click(await screen.findByText("Review evidence for AI"));await screen.findByText(/Preview evidence/);
  expect((screen.getByText("Explain this resource") as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByText("Explain this resource"));await screen.findByText("Two cumulative restarts");
  fireEvent.click(screen.getByText("What the evidence shows"));fireEvent.click(screen.getByRole("button",{name:"View evidence E1"}));await screen.findByText("E1 · Deployment api");
  fireEvent.click(screen.getByText("Open related resource"));expect(open).toHaveBeenCalledWith(resource);
 });
 it("keeps a completed answer across closing and reopening, even if the backend is offline",async()=>{
  const {fetcher}=setup();const first=view();await start();await screen.findByText("Two cumulative restarts");first.unmount();
  vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("offline");}));view();
  expect(screen.getByText("Two cumulative restarts")).toBeTruthy();expect(screen.getByText(/Saved in this browser/)).toBeTruthy();
  expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
 });
 it("reattaches to a background job after the view closes without another model call",async()=>{
  const control=setup({running:true});const first=view();await start();await screen.findByRole("region",{name:"Explanation in progress"});
  first.unmount();expect(control.fetcher.mock.calls.some(([,init])=>init?.method==="DELETE")).toBe(false);
  control.complete();view();await screen.findByText("Two cumulative restarts");
  expect(control.fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
 });
 it("polls the accepted job to completion and focuses its saved result",async()=>{
  const control=setup({running:true});view();await start();await screen.findByRole("region",{name:"Explanation in progress"});
  vi.useFakeTimers();control.complete();await act(async()=>{await vi.advanceTimersByTimeAsync(2100);});vi.useRealTimers();
  await screen.findByText("At a glance");expect(document.activeElement).toBe(screen.getByRole("region",{name:"AI explanation result"}));
  expect(screen.getByText("Evidence and explanation options").closest("details")?.open).toBe(false);
 });
 it("explicit cancellation stops a job and keeps its previous answer",async()=>{
  const control=setup();view();await start();await screen.findByText("Two cumulative restarts");
  // Start a fresh model request while retaining the saved result.
  const running:AIJob={id:"job-2",cluster,uid:"w",range:900,state:"running",started:new Date().toISOString(),evidence:pack};
  vi.stubGlobal("fetch",vi.fn(async (_url:string,init?:RequestInit)=>({ok:true,status:200,json:async()=>init?.method==="DELETE"?{...running,state:"canceled"}:running})));
  fireEvent.click(screen.getByText("Evidence and explanation options"));
  // Preview remains available from the first run; consent was retained within this view.
  fireEvent.click(screen.getByText("Explain again"));await screen.findByRole("region",{name:"Explanation in progress"});
  expect(screen.getByText("Two cumulative restarts")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Cancel request"}));
  await waitFor(()=>expect(screen.queryByRole("region",{name:"Explanation in progress"})).toBeNull());expect(screen.getByText("Two cumulative restarts")).toBeTruthy();
  expect(control.fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
 });
 it("reports a failed start without fabricating an answer",async()=>{
  setup({fail:true});view();await start();expect((await screen.findByRole("alert")).textContent).toContain("AI provider unavailable");
 });
});
