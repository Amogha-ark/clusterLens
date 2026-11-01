import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { getJSON } from "./lib";
import type { Resource } from "./types";
import "./ai.css";
import { AIWaiting } from "./AIWaiting";

import { loadAIResult, saveAIResult, validResult } from "./aiInvestigation";
import type { AIResult as Result, AIJob, Pack } from "./aiInvestigation";
type Status = { enabled: boolean; provider?: string; model?: string; endpoint?: string };

export function AIExplanation({ resource, range, onOpen, resources, cluster = "clusterlens-local" }: {
  cluster?: string; resource: Resource; range: number; onOpen: (r: Resource) => void; resources: Resource[];
}) {
 const [status, setStatus] = useState<Status | null>(null);
 const [preview, setPreview] = useState<Pack | null>(null);
 const [result, setResult] = useState<Result | null>(() => loadAIResult(cluster, resource.uid, range));
 const [error, setError] = useState("");
 const [phase, setPhase] = useState<"preview" | "explanation" | null>(null);
 const busy = phase !== null;
 const actionButton = useRef<HTMLButtonElement>(null);
 const answerRegion = useRef<HTMLDivElement>(null);
 const previousPhase = useRef(phase);
 useEffect(() => {
   if (previousPhase.current === "explanation" && phase === null) {
     if (result) answerRegion.current?.focus();
     else actionButton.current?.focus();
   }
   previousPhase.current = phase;
 }, [phase]);
 const [notice, setNotice] = useState("");
 const [job, setJob] = useState<AIJob | null>(null);
 const [saved, setSaved] = useState<"browser" | "session">("browser");
 const [consent, setConsent] = useState(false);
 const [expanded, setExpanded] = useState(false);
 const [chosen, setChosen] = useState<string | null>(null);
 const request = useRef<AbortController | null>(null);
 const operation = useRef(0);
 useEffect(() => {
  const c = new AbortController();
  getJSON<Status>("/api/v1/ai/status", c.signal).then(setStatus).catch(() => { if (!c.signal.aborted) setError("Could not load AI configuration."); });
  return () => { c.abort(); request.current?.abort(); };
 }, []);
 async function prepare() {
  request.current?.abort(); const c = new AbortController(); request.current = c;
  setExpanded(true); setPhase("preview"); setError(""); setNotice("");
  try { const p = await getJSON<Pack>("/api/v1/ai/evidence?" + new URLSearchParams({uid: resource.uid, range: String(range)}), c.signal); if (!c.signal.aborted) setPreview(p); }
  catch(e) { if (!c.signal.aborted) setError(String(e)); }
  finally { if (!c.signal.aborted) setPhase(null); }
 }
 function receive(j: AIJob) {
  if (!j || j.uid !== resource.uid || j.range !== range || j.cluster !== cluster) return;
  setJob(j);
  if (j.state === "running") {
   setPreview(j.evidence); setExpanded(true); setPhase("explanation");
  } else {
   setPhase(null);
   if (j.state === "completed" && validResult(j.result)) {
    setResult(j.result); setSaved(saveAIResult(cluster, j.result) ? "browser" : "session"); setError("");
   } else if (j.state === "failed") setError(j.error || "Explanation failed. You can try again.");
   else if (j.state === "canceled") setNotice("Request canceled. Your previous explanation is still available.");
  }
 }
 useEffect(() => {
  const c = new AbortController(); const token = operation.current;
  fetch("/api/v1/ai/jobs?" + new URLSearchParams({uid:resource.uid, range:String(range)}), {signal:c.signal})
   .then(async response => { if (response.ok) { const j = await response.json(); if (!c.signal.aborted && token === operation.current) receive(j); } })
   .catch(() => { /* A browser-saved answer remains available if the backend is offline. */ });
  return () => c.abort();
 }, [cluster, resource.uid, range]);
 useEffect(() => {
  if (!job || job.state !== "running") return;
  const c = new AbortController(); const token = operation.current; let timer: ReturnType<typeof setTimeout>;
  async function poll() {
   try {
    const response = await fetch("/api/v1/ai/jobs/" + encodeURIComponent(job!.id), {signal:c.signal});
    if (response.status === 404) {
      if (!c.signal.aborted && token === operation.current) {setJob(null); setPhase(null); setError("Investigation expired or the backend restarted. Start a new explanation, or review a saved answer if available.");}
      return;
    }
    if (!response.ok) throw new Error("Could not retrieve the investigation.");
    const j = await response.json(); if (!c.signal.aborted && token === operation.current) { setError(""); receive(j); }
   } catch (e) { if (!c.signal.aborted && token === operation.current) setError(String(e) + " Reconnecting…"); }
   if (!c.signal.aborted && token === operation.current) timer = setTimeout(() => void poll(), 2000);
  }
  void poll();
  return () => { c.abort(); clearTimeout(timer); };
 }, [job?.id, job?.state]);
 async function explain() {
  operation.current++;
  request.current?.abort(); const c = new AbortController(); request.current = c;
  setPhase("explanation"); setError(""); setChosen(null); setNotice("");
  try {
   const response = await fetch("/api/v1/ai/jobs", { method: "POST", signal: c.signal, headers: {"Content-Type":"application/json", "X-ClusterLens-AI":"1"}, body: JSON.stringify({uid:resource.uid, range, consent}) });
   const data = await response.json(); if (!response.ok) throw new Error(data.error || "Explanation failed");
   if (!c.signal.aborted) receive(data as AIJob);
  } catch(e) { if (!c.signal.aborted) { setError(String(e)); setPhase(null); } }
 }
 async function cancel() {
  if (job?.state === "running") {
   try {
    const response = await fetch("/api/v1/ai/jobs/" + encodeURIComponent(job.id), {method:"DELETE", headers:{"X-ClusterLens-AI":"1"}});
    if (!response.ok) throw new Error("Could not cancel. The investigation may still be running.");
    const canceled = await response.json(); operation.current++; receive(canceled);
   } catch(e) { setError(String(e)); }
  } else {
   request.current?.abort(); setPhase(null); setNotice("View closed. Reopen this resource to recover any accepted investigation.");
  }
 }

 const pack = phase === "explanation" ? preview : result?.evidence || preview;
 const evidence = pack?.items.find(e => e.id === chosen);
 function findings(items: Result["explanation"]["findings"]) { return <ul>{items.map((f, i) => <li key={i}><p>{f.text}</p><div className="ai-citations">{f.evidenceIds.map(id => <button key={id} onClick={() => setChosen(id)} aria-label={`View evidence ${id}`}>{id}</button>)}</div></li>)}</ul>; }
 return <section className="ai-explanation" aria-label="AI explanation">
  <div className="ai-heading"><Sparkles size={18}/><h3>Understand this resource</h3><span className="ai-label">Optional AI</span></div>
  <div ref={answerRegion} tabIndex={result ? -1 : undefined} role={result ? "region" : undefined} aria-label={result ? "AI explanation result" : undefined} className="ai-answer" aria-live="polite">{result && <>
   <p className="ai-label">{phase === "explanation" ? "Previous explanation" : "AI interpretation"} · verify against evidence · {new Date(result.evidence.timestamp).toLocaleString()}</p>
   <p className="ai-saved-note">{saved === "browser" ? "Saved in this browser for up to 24 hours" : "Browser storage is unavailable; saved for this page session"} · Snapshot from the time shown, not a live diagnosis.</p>
   <h4 className="ai-answer-title">At a glance</h4>
   <p className="ai-summary">{result.explanation.summary}</p>
   <details className="ai-findings"><summary>What the evidence shows <span>{result.explanation.findings.length}</span></summary>{findings(result.explanation.findings)}</details>
   <details className="ai-findings"><summary>Suggested checks <span>{result.explanation.nextChecks.length}</span></summary>{findings(result.explanation.nextChecks)}</details>
   <details><summary>Coverage and limitations</summary><ul>{result.evidence.limitations.map(l => <li key={l}>{l}</li>)}</ul></details>
  </>}</div>
  {!status && !error && <p>Loading AI configuration…</p>}
  {status && !status.enabled && <p>AI is off. Configure Ollama or OpenAI on the backend to enable evidence-based explanations.</p>}
  {status?.enabled && <details className="ai-setup" open={!result || busy}>
   <summary>{result ? "Evidence and explanation options" : "Review evidence and permissions"}</summary>
   <p>A plain-language explanation of observed health and suggested checks, with evidence you can inspect.</p>
   <p className="ai-provider">{status.provider === "openai" ? "External provider: OpenAI" : "Ollama endpoint"} · {status.model}<br/>{status.endpoint}</p>
   {!expanded && <button className="button" onClick={() => void prepare()}>Review evidence for AI</button>}
   {expanded && <>
    {phase !== "explanation" && <p>Only selected status, sampled metrics, up to 20 related resources and 20 events are sent. No logs, labels, environment variables or Secrets. Resource names remain visible. Redaction is best effort.</p>}
    {!preview && !busy && <button onClick={() => void prepare()}>Retry evidence preview</button>}
    {phase !== "explanation" && pack && <details><summary>Preview evidence · {pack.items.length} entries</summary><pre>{JSON.stringify(pack, null, 2)}</pre></details>}
    {phase !== "explanation" && <>
    <p>Evidence is refreshed when you request an explanation. The result includes the exact bundle used.</p>
    <label className="ai-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy}/><span>Send this resource’s evidence to {status.provider === "openai" ? "OpenAI (external API; usage charges may apply)" : "the configured Ollama server"} for this explanation.</span></label>
    </>}
    {phase === "preview" && <p role="status">Preparing your evidence preview…</p>}
    {phase === "explanation" && preview ? <AIWaiting
      model={status.model || "Configured model"} provider={status.provider || ""}
      resourceName={resource.name} entries={preview.items} startedAt={job?.state === "running" ? job.started : undefined} onCancel={() => void cancel()}
    /> : <div className="ai-actions"><button ref={actionButton} className="button" disabled={busy || !consent || !preview} onClick={() => void explain()}>{result ? "Explain again" : error ? "Try explanation again" : "Explain this resource"}</button>{busy && <button onClick={() => void cancel()}>Cancel request</button>}</div>}

   </>}
  </details>}
  {notice && <p role="status">{notice}</p>}
  {error && <p role="alert">{error}</p>}

  {evidence && <div className="ai-evidence"><h4>{evidence.id} · {evidence.title}</h4><pre>{JSON.stringify(evidence.data,null,2)}</pre>{resources.find(r => r.uid === evidence.resourceUid) && <button onClick={() => { const r = resources.find(r => r.uid === evidence.resourceUid); if(r) onOpen(r); }}>Open related resource</button>}</div>}
 </section>;
}
