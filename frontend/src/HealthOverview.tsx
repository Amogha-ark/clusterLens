import { useState } from 'react';
import { ChevronRight, Cpu, Layers3, ArrowUpRight } from 'lucide-react';
import type { Resource, Snapshot } from './types';
import { bytes, healthy } from './lib';
import { clusterHealth, workloadRoots } from './insights';
import { attentionItems, currentNodeUsage } from './health';
import './health.css';

export function HealthOverview({snapshot, error, onOpen, onNavigate}: {
  snapshot: Snapshot; error: string; onOpen: (r: Resource) => void;
  onNavigate: (view: 'Workloads' | 'Nodes' | 'Storage' | 'Events') => void;
}) {
  const [filter, setFilter] = useState<'attention' | 'unknown'>('attention');
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const health = clusterHealth(snapshot, error);
  const queue = attentionItems(snapshot.resources);
  const usage = currentNodeUsage(snapshot, error);
  const incomplete = health.level === 'unknown';
  const unknown = [...new Map([...workloadRoots(snapshot.resources), ...snapshot.resources.filter(r => ['Node','PersistentVolumeClaim','Pod'].includes(r.kind))].filter(r => !r.status || r.status === 'Unknown').map(r => [r.uid, r])).values()];
  const claims = snapshot.resources.filter(r => r.kind === 'PersistentVolumeClaim');
  const affectedWorkloads = queue.filter(i => health.workloads.some(w => w.uid === i.resource.uid));
  const noReady = affectedWorkloads.filter(i => i.category === 'No ready replicas').length;
  const reduced = affectedWorkloads.filter(i => i.category === 'Reduced readiness').length;
  const level = incomplete || unknown.length ? 'unknown' : queue.length ? 'attention' : health.level;
  const title = level === 'unknown' ? 'Your cluster’s health is unclear.' : queue.length ? `${queue.length} resource${queue.length === 1 ? '' : 's'} need${queue.length === 1 ? 's' : ''} attention.` : health.title;
  const description = level === 'unknown' ? 'Some resource states are missing or out of date. Review the available evidence; current health cannot be confirmed.' : queue.length ? `${affectedWorkloads.length} affected workload${affectedWorkloads.length === 1 ? '' : 's'}. Review readiness and reported symptoms below.` : health.level === 'limited' ? health.description : 'Observed resources report healthy states. Nodes are ready and storage claims are bound; completed, suspended and scaled-to-zero workloads are included.';
  const allRows = filter === 'unknown' ? unknown.map(resource => ({resource, symptoms:'Resource status unavailable', category:'Unknown', priority:4})) : queue;
  const rows = allRows.filter(i => `${i.resource.name} ${i.resource.namespace} ${i.symptoms}`.toLowerCase().includes(search.toLowerCase()));
  const visible = expanded ? rows : rows.slice(0,5);
  const showQueue = queue.length > 0 || unknown.length > 0;
  function reveal() {setFilter('attention');setExpanded(true);setSearch('');document.getElementById('attention-heading')?.focus();}
  const affectedIds = new Set(affectedWorkloads.map(i => i.resource.uid));
  return <>
    <section className={`cluster-health-card ${level}`} aria-label="Cluster health">
      <div className="health-card-meta"><span>CLUSTER HEALTH</span><span>All namespaces · {incomplete ? 'Incomplete observation' : `Snapshot ${new Date(snapshot.timestamp).toLocaleTimeString()}`}</span></div>
      <h2>{title}</h2><p className="health-card-description">{description}</p>
      {queue.length > 0 && <div className="health-severity"><span>{noReady} workloads with no ready replicas</span><span>{reduced} with reduced readiness</span>{unknown.length > 0 && <span>{unknown.length} additional unknown</span>}</div>}
      <div className="health-card-links">
        <button onClick={() => onNavigate('Nodes')}><i />{incomplete ? 'Last observed: ' : ''}{health.nodes.filter(healthy).length} of {health.nodes.length} nodes ready<ChevronRight size={16}/></button>
        <button onClick={() => affectedWorkloads.length ? reveal() : onNavigate('Workloads')}><i />{incomplete ? 'Last observed: ' : ''}{health.workloads.filter(r => healthy(r) && !affectedIds.has(r.uid)).length} of {health.workloads.length} workloads healthy<ChevronRight size={16}/></button>
        <button onClick={() => onNavigate('Storage')}><i />{incomplete ? 'Last observed: ' : ''}{claims.filter(r => r.status === 'Bound').length} of {claims.length} claims bound<ChevronRight size={16}/></button>
      </div>
      <div className="health-card-metrics">
        <div><span><Cpu size={19}/>CPU in use</span><strong>{usage.count ? usage.cpu.toFixed(2) : '—'}<small>cores</small></strong></div>
        <div><span><Layers3 size={19}/>Memory in use</span><strong>{usage.count ? bytes(usage.memory).split(' ')[0] : '—'}<small>{usage.count ? bytes(usage.memory).split(' ')[1] : 'GiB'}</small></strong></div>
        <p>{usage.count ? `${usage.count} of ${usage.total} nodes measured${snapshot.truncated ? ' in truncated inventory' : ''} · ${usage.count !== usage.total || snapshot.truncated ? 'partial usage' : 'cluster-wide usage'}` : 'Current measurements unavailable'}<small>Resource readiness does not establish application availability or physical disk health.</small></p>
      </div>
    </section>
    {showQueue && <section className="health-attention" aria-labelledby="attention-heading">
      <div className="health-attention-header"><div><h2 id="attention-heading" tabIndex={-1}>{incomplete ? 'Last observed resource issues' : 'Needs attention'}</h2><p>All namespaces · grouped by ownership · no ready replicas first</p></div><div className="health-queue-controls"><button aria-pressed={filter === 'attention'} onClick={() => {setFilter('attention');setExpanded(false)}}>Attention · {queue.length}</button><button aria-pressed={filter === 'unknown'} onClick={() => {setFilter('unknown');setExpanded(false)}}>Unknown · {unknown.length}</button></div></div>
      {expanded && <label className="health-search">Find a resource<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, namespace or symptom" /></label>}
      <div className="health-table-scroll"><table><thead><tr><th>Resource</th><th>Observed symptom</th><th>Readiness</th><th><span className="sr-only">Investigation</span></th></tr></thead><tbody>{visible.map(i => <tr key={i.resource.uid}><td><strong>{i.resource.name}</strong><small>{i.resource.kind} · {i.resource.namespace || 'Cluster-wide'}</small></td><td><span>{i.symptoms}</span><small>{i.category}</small></td><td>{['Deployment','StatefulSet','DaemonSet','ReplicaSet','Pod'].includes(i.resource.kind) ? `${i.resource.ready} / ${i.resource.desired}` : '—'}</td><td><button aria-label={`Investigate ${i.resource.name}`} onClick={() => onOpen(i.resource)}>Investigate<ArrowUpRight size={15}/></button></td></tr>)}</tbody></table></div>
      {!visible.length && <p className="health-queue-empty">{filter === 'unknown' && !unknown.length ? 'No explicit unknown resource states in this snapshot. Missing discovery sources can still leave resources unobserved.' : 'No matching resources.'}</p>}
      <div className="health-attention-footer"><span>Showing {visible.length} of {rows.length} {incomplete ? 'last observed ' : ''}resources</span>{(allRows.length > 5 || expanded) && <button onClick={() => {setExpanded(!expanded);setSearch('')}}>{expanded ? 'Show fewer' : `View all ${allRows.length} resources`}<ChevronRight size={15}/></button>}</div>
    </section>}
  </>;
}
