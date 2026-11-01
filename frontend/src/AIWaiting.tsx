import { useEffect, useRef, useState } from "react";
import { Check, Clock3, Sparkles } from "lucide-react";

export function AIWaiting({ model, provider, resourceName, entries, onCancel, startedAt }: {
  startedAt?: string;
  model: string;
  provider: string;
  resourceName: string;
  entries: { id: string; title: string }[];
  onCancel: () => void;
}) {
  const region = useRef<HTMLElement>(null);
  const [started] = useState(() => startedAt ? Date.parse(startedAt) : Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    region.current?.focus();
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [started]);
  const message = seconds >= 45
    ? "Taking a little longer. You can keep exploring this resource or cancel and try again."
    : seconds >= 20
      ? "Still waiting for the model. Your resource views remain available below."
      : provider === "ollama"
        ? "Local models may take a moment to load into memory before answering."
        : "Waiting for the provider’s response. Your resource views remain available below.";
  return (
    <section ref={region} tabIndex={-1} className="ai-waiting" aria-label="Explanation in progress">
      <div className="ai-waiting-top">
        <span className="ai-waiting-orbit" aria-hidden="true"><Sparkles size={22}/><i/><i/><i/></span>
        <div className="ai-waiting-title">
          <span className="ai-label">A little context. A clearer picture.</span>
          <h4>Making sense of {resourceName}</h4>
        </div>
        <span className="ai-elapsed" role="timer" aria-live="off" aria-label={`${seconds} seconds elapsed`}><Clock3 size={13}/>{seconds}s</span>
      </div>
      <p className="ai-waiting-message" role="status">{message}</p>
      <div className="ai-waiting-connection">
        <span><Check size={13} aria-hidden="true"/>Preview ready · {entries.length} entries</span>
        <span className="ai-connection-line" aria-hidden="true"/>
        <span><span className="ai-pending-dot" aria-hidden="true"/>Response pending</span>
      </div>
      <details className="ai-waiting-evidence">
        <summary>While you wait: explore the evidence</summary>
        <p>From your preview, before AI interpretation:</p>
        <ul>{entries.slice(0, 4).map(e => <li key={e.id}><span>{e.id}</span>{e.title}</li>)}</ul>
        <p>You can switch views or close this tab. The investigation continues on the backend; reopen this resource with the same time window to recover it.</p>
      </details>
      <div className="ai-waiting-footer">
        <span>{model} · {provider === "ollama" ? "Ollama" : "OpenAI"}<small>Responses can take up to a minute.</small></span>
        <button onClick={onCancel}>Cancel request</button>
      </div>
    </section>
  );
}
