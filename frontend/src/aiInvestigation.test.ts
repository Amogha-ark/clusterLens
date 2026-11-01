import {afterEach,describe,expect,it,vi} from "vitest";
import {AI_STORAGE_KEY,loadAIResult,saveAIResult} from "./aiInvestigation";
import type {AIResult} from "./aiInvestigation";
const answer=(uid:string,range=900,timestamp=new Date().toISOString()):AIResult=>({provider:"ollama",model:"local",evidence:{uid,range,timestamp,since:timestamp,items:[],limitations:[]},explanation:{summary:"Saved explanation",findings:[],nextChecks:[]}});
afterEach(()=>vi.unstubAllGlobals());
describe("bounded browser investigations",()=>{
 it("scopes saved results by cluster, UID and window",()=>{
  const values=new Map<string,string>();vi.stubGlobal("localStorage",{getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v)});
  const result=answer("cache-scope");expect(saveAIResult("one",result)).toBe(true);
  expect(loadAIResult("one","cache-scope",900)?.explanation.summary).toBe("Saved explanation");
  expect(loadAIResult("two","cache-scope",900)).toBeNull();expect(loadAIResult("one","cache-scope",3600)).toBeNull();expect(loadAIResult("one","replaced",900)).toBeNull();
 });
 it("bounds retention and tolerates corrupt storage and blocked writes",()=>{
  let raw="corrupt";vi.stubGlobal("localStorage",{getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;}});
  expect(loadAIResult("bounds","none",900)).toBeNull();
  for(let i=0;i<30;i++) saveAIResult("bounds",answer("cache-"+i));
  expect(JSON.parse(raw).length).toBeLessThanOrEqual(20);
  raw=JSON.stringify([{cluster:"expired",result:answer("old",900,new Date(Date.now()-25*3600000).toISOString())}]);
  expect(loadAIResult("expired","old",900)).toBeNull();
  vi.stubGlobal("localStorage",{getItem:()=>{throw new Error("blocked");},setItem:()=>{throw new Error("blocked");}});
  expect(saveAIResult("blocked",answer("memory"))).toBe(false);expect(loadAIResult("blocked","memory",900)).not.toBeNull();
  expect(AI_STORAGE_KEY).toContain("v1");
 });
});
