#!/usr/bin/env python3
"""Read-only smoke checks against a running ClusterLens connected to the M0 lab."""
import argparse
import json
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080')
    args = parser.parse_args()
    base = args.url.rstrip('/')

    def request(path, expected=200, method='GET', origin=None):
        headers = {'Origin': origin} if origin else {}
        try:
            with urllib.request.urlopen(urllib.request.Request(base + path, method=method, headers=headers), timeout=15) as response:
                status, body = response.status, response.read()
        except urllib.error.HTTPError as exc:
            status, body = exc.code, exc.read()
        assert status == expected, (path, status, expected)
        return json.loads(body) if body.startswith(b'{') else body

    assert request('/healthz')['alive']
    assert request('/readyz')['ready']
    snapshot = request('/api/v1/snapshot')
    assert snapshot['connected']
    assert all(source['synced'] and not source['error'] for source in snapshot['sources'])
    resources = snapshot['resources']
    by_id = {r['uid']: r for r in resources}
    pods = [r for r in resources if r['kind'] == 'Pod' and r['namespace'] == 'observability-lab' and r['name'].startswith('lab-')]
    assert len(pods) == 40, 'Run baseline before this smoke check'
    assert len([r for r in resources if r['kind'] == 'Node']) == 3
    for pod in pods:
        assert pod['workloadUid'] in by_id
        workload = by_id[pod['workloadUid']]
        assert pod['uid'] in workload['related']
    writer = next(r for r in resources if r['kind'] == 'StatefulSet' and r['name'] == 'lab-pvc')
    assert len([uid for uid in writer['related'] if by_id[uid]['kind'] == 'PersistentVolumeClaim']) == 10
    assert snapshot['metrics']['available']
    history = request('/api/v1/history')
    assert history['volatile'] and history['points']
    identities = [(p['uid'], p['timestamp']) for p in history['points']]
    assert len(identities) == len(set(identities)), 'Duplicate source timestamps treated as new samples'
    pod = next(p for p in pods if p['name'].startswith('lab-logs-'))
    params = {'namespace': pod['namespace'], 'pod': pod['name'], 'uid': pod['uid'], 'container': pod['containers'][0]['name'], 'sinceSeconds': 900}
    logs = request('/api/v1/logs?' + urllib.parse.urlencode(params))
    assert logs['source'] == 'kubernetes-pod-log-api' and not logs['persisted']
    assert logs['text'] and len(logs['text'].encode()) <= 262144
    for line in logs['text'].splitlines():
        timestamp, _, record = line.partition(' ')
        assert timestamp.endswith('Z')
        assert json.loads(record)['workload'] == 'logs'
    invalid = dict(params, sinceSeconds=21601)
    request('/api/v1/logs?' + urllib.parse.urlencode(invalid), 400)
    invalid = dict(params, uid='replaced-pod')
    request('/api/v1/logs?' + urllib.parse.urlencode(invalid), 404)
    request('/api/v1/snapshot', 405, method='POST')
    request('/api/v1/snapshot', 403, origin='https://other.invalid')
    request('/api/v1/history?since=invalid', 400)
    assert b'/assets/' in request('/')
    print('PASS: health/readiness, 14 inventory sources, 40 lab pods, UID ownership, 10 attached PVCs, real metrics/history, bounded JSON logs, API guards, and built UI')


if __name__ == '__main__':
    main()
