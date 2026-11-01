import type { Resource, Snapshot } from './types';
import { healthy } from './lib';
import { workloadRoots } from './insights';

export type AttentionItem = { resource: Resource; symptoms: string; category: string; priority: number };

// Group only through ownership, never through shared node or volume relationships.
export function attentionItems(resources: Resource[]): AttentionItem[] {
  const roots = workloadRoots(resources);
  const byId = new Map(resources.map(r => [r.uid, r]));
  const rootIds = new Set(roots.map(r => r.uid));
  const grouped = new Map<string, Resource[]>();
  const extras: Resource[] = [];
  for (const pod of resources.filter(r => r.kind === 'Pod' && !healthy(r) && !['Succeeded', 'Completed', 'Unknown', ''].includes(r.status))) {
    let id = pod.workloadUid;
    if (!rootIds.has(id)) {
      id = pod.uid;
      const seen = new Set<string>();
      while (!rootIds.has(id) && byId.get(id)?.ownerUid && !seen.has(id)) {
        seen.add(id);
        id = byId.get(id)!.ownerUid;
      }
    }
    if (rootIds.has(id)) grouped.set(id, [...(grouped.get(id) || []), pod]);
    else extras.push(pod);
  }
  const candidates = [...roots, ...extras, ...resources.filter(r => ['Node', 'PersistentVolumeClaim'].includes(r.kind))];
  return candidates.filter(r => r.status && r.status !== 'Unknown' && (!healthy(r) || grouped.has(r.uid)))
    .map(resource => {
      const pods = grouped.get(resource.uid) || [];
      const counts = new Map<string, number>();
      for (const p of pods) {
        const symptom = p.status === 'Running' ? 'not ready' : p.status;
        counts.set(symptom, (counts.get(symptom) || 0) + 1);
      }
      const noReplicas = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Pod'].includes(resource.kind) && resource.desired > 0 && resource.ready === 0;
      const reduced = resource.desired > resource.ready && !['Job', 'CronJob'].includes(resource.kind);
      return {
        resource,
        symptoms: pods.length ? [...counts].map(([s,n]) => `${n} pod${n === 1 ? '' : 's'}: ${s}`).join(' · ') : [resource.status, ...resource.conditions].filter(Boolean).join(' · '),
        category: noReplicas ? 'No ready replicas' : reduced ? 'Reduced readiness' : resource.kind === 'Node' ? 'Node condition' : resource.kind === 'PersistentVolumeClaim' ? 'Storage claim' : 'Needs review',
        priority: noReplicas ? 0 : resource.kind === 'Node' ? 1 : reduced ? 2 : 3,
      };
    }).sort((a,b) => a.priority - b.priority || a.resource.namespace.localeCompare(b.resource.namespace) || a.resource.name.localeCompare(b.resource.name));
}

export function currentNodeUsage(snapshot: Snapshot, error = '', now = Date.now()) {
  const nodes = snapshot.resources.filter(r => r.kind === 'Node');
  const snapshotAge = now - Date.parse(snapshot.timestamp);
  const available = snapshot.connected && !error && snapshot.metrics.available && Number.isFinite(snapshotAge) && snapshotAge >= -5000 && snapshotAge <= 30000;
  const measured = available ? nodes.filter(n => {
    if (!n.usage) return false;
    const age = now - Date.parse(n.usage.timestamp);
    return Number.isFinite(age) && age >= -5000 && age < 90000 && Number.isFinite(n.usage.cpu) && n.usage.cpu >= 0 && Number.isFinite(n.usage.memory) && n.usage.memory >= 0;
  }) : [];
  return { count: measured.length, total: nodes.length, cpu: measured.reduce((v,n) => v + n.usage!.cpu,0), memory: measured.reduce((v,n) => v + n.usage!.memory,0) };
}
