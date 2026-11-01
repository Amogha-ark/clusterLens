export type Evidence = { id: string; resourceUid: string; title: string; data: unknown };
export type Pack = { uid: string; timestamp: string; since: string; range: number; items: Evidence[]; limitations: string[] };
export type Finding = { text: string; evidenceIds: string[] };
export type AIResult = { explanation: { summary: string; findings: Finding[]; nextChecks: Finding[] }; evidence: Pack; provider: string; model: string };
export type AIJob = { id: string; cluster: string; uid: string; range: number; state: "running" | "completed" | "failed" | "canceled"; started: string; evidence: Pack; result?: AIResult; error?: string };
export const AI_STORAGE_KEY = "clusterlens.ai.investigations.v1";
const maxAge = 24 * 60 * 60 * 1000;
type Saved = { cluster: string; result: AIResult };
let memory: Saved[] = [];
export function validResult(value: unknown): value is AIResult {
  const r = value as AIResult | undefined;
  return !!r && typeof r.explanation?.summary === "string" &&
    Array.isArray(r.explanation.findings) && Array.isArray(r.explanation.nextChecks) &&
    [...r.explanation.findings, ...r.explanation.nextChecks].every(f => typeof f?.text === "string" && Array.isArray(f.evidenceIds) && f.evidenceIds.every(id => typeof id === "string")) &&
    typeof r.evidence?.uid === "string" && Number.isFinite(r.evidence.range) &&
    typeof r.evidence.timestamp === "string" && Array.isArray(r.evidence.items) &&
    r.evidence.items.every(e => typeof e?.id === "string" && typeof e.title === "string" && typeof e.resourceUid === "string") && Array.isArray(r.evidence.limitations) && r.evidence.limitations.every(l => typeof l === "string");
}
function records(): Saved[] {
  let values = memory;
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    if (raw && raw.length <= 1_000_000) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) values = [...memory, ...parsed];
    }
  } catch { /* Storage restrictions must not prevent an investigation. */ }
  return values.filter(v => typeof v?.cluster === "string" && validResult(v.result) &&
    Date.now() - Date.parse(v.result.evidence.timestamp) >= 0 &&
    Date.now() - Date.parse(v.result.evidence.timestamp) < maxAge)
    .sort((a,b) => Date.parse(b.result.evidence.timestamp) - Date.parse(a.result.evidence.timestamp))
    .filter((v,i,all) => all.findIndex(other => other.cluster === v.cluster && other.result.evidence.uid === v.result.evidence.uid && other.result.evidence.range === v.result.evidence.range) === i).slice(0,20);
}
export function loadAIResult(cluster: string, uid: string, range: number): AIResult | null {
  return records().find(v => v.cluster === cluster && v.result.evidence.uid === uid && v.result.evidence.range === range)?.result || null;
}
export function saveAIResult(cluster: string, result: AIResult): boolean {
  const values = [{cluster, result}, ...records().filter(v => !(v.cluster === cluster && v.result.evidence.uid === result.evidence.uid && v.result.evidence.range === result.evidence.range))].slice(0, 20);
  let raw = JSON.stringify(values);
  while (raw.length > 1_000_000 && values.length > 1) { values.pop(); raw = JSON.stringify(values); }
  memory = values;
  try { localStorage.setItem(AI_STORAGE_KEY, raw); return true; } catch { return false; }
}
