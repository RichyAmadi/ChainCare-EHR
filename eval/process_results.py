"""Aggregate Caliper and API results into tables (JSON) and publication charts (PNG)."""
import json, re, statistics as st, glob, os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

R = os.environ.get('CALIPER_REPORTS', '/root/ehr/caliper/reports2')
OUT = '/root/ehr/results'
FIG = '/root/ehr/figures'
TEAL, AMBER, INK, GRID = '#0f6b4f', '#c27c0e', '#1c2421', '#e3e8e6'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.edgecolor': '#7a8783', 'axes.labelcolor': INK,
                     'xtick.color': INK, 'ytick.color': INK, 'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.grid': True, 'grid.color': GRID, 'axes.axisbelow': True, 'figure.dpi': 200})

def parse_log(path):
    rows = {}
    for line in open(path):
        m = re.match(r'^\|\s*(W\d[^|]*?|Setup[^|]*?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|', line)
        if m:
            n = m.group(1).strip()
            rows[n] = dict(succ=int(m.group(2)), fail=int(m.group(3)), send=float(m.group(4)), maxLat=float(m.group(5)),
                           minLat=float(m.group(6)), avgLat=float(m.group(7)), tps=float(m.group(8)))
    return rows

# ---------- main benchmark, mean over runs ----------
runs = [parse_log(p) for p in sorted(glob.glob(f'{R}/main_run[0-9].log'))]
labels = [k for k in runs[0] if k.startswith('W')]
main = []
for lab in labels:
    vals = [r[lab] for r in runs if lab in r]
    agg = lambda k: (round(st.mean(v[k] for v in vals), 2), round(st.pstdev(v[k] for v in vals), 2))
    main.append(dict(workload=lab, runs=len(vals), succ=sum(v['succ'] for v in vals), fail=sum(v['fail'] for v in vals),
                     send=agg('send'), tps=agg('tps'), avgLat=agg('avgLat'), maxLat=agg('maxLat'), minLat=agg('minLat'),
                     successPct=round(100 * sum(v['succ'] for v in vals) / max(1, sum(v['succ'] + v['fail'] for v in vals)), 2)))
json.dump(main, open(f'{OUT}/caliper_main.json', 'w'), indent=2)

fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
names = [m['workload'].split(' ')[0] + '\n' + '\n'.join(m['workload'].replace('patient ', '').split(' ')[1:]) for m in main]
writes = [not any(s in m['workload'] for s in ('Read', 'Query')) for m in main]
cols = [TEAL if w else '#5b8fd1' for w in writes]
ax[0].bar(names, [m['tps'][0] for m in main], yerr=[m['tps'][1] for m in main], color=cols, capsize=4)
ax[0].axhline(100, ls='--', color='#7a8783', lw=1); ax[0].text(5.4, 102, 'offered load 100 TPS', ha='right', fontsize=9, color='#5d6b66')
ax[0].set_ylabel('Throughput (TPS)'); ax[0].set_title('Throughput by workload', loc='left', fontweight='bold')
bl = ax[1].bar(names, [m['avgLat'][0] for m in main], yerr=[m['avgLat'][1] for m in main], color=cols, capsize=4); ax[1].bar_label(bl, labels=[f"{m['avgLat'][0]:.2f} s" for m in main], fontsize=9, padding=14)
ax[1].set_ylabel('Average latency (s)'); ax[1].set_title('Average latency by workload', loc='left', fontweight='bold')
for a in ax: a.tick_params(axis='x', labelsize=9)
from matplotlib.patches import Patch
ax[0].legend(handles=[Patch(color=TEAL, label='write (ordered, committed)'), Patch(color='#5b8fd1', label='read / query (evaluate)')], fontsize=9, loc='upper left', frameon=False, bbox_to_anchor=(0, 0.93))
fig.tight_layout(); fig.savefig(f'{FIG}/caliper_main.png'); plt.close(fig)

# ---------- scalability sweep ----------
sw = parse_log(f'{R}/scalability.log')
wr = sorted([(int(k.split('@')[1]), v) for k, v in sw.items() if k.startswith('W1')])
rd = sorted([(int(k.split('@')[1]), v) for k, v in sw.items() if k.startswith('W2')])
json.dump({'writes': [dict(target=t, **v) for t, v in wr], 'reads': [dict(target=t, **v) for t, v in rd]}, open(f'{OUT}/caliper_scalability.json', 'w'), indent=2)
fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
for data, col, mk, lab in [(wr, TEAL, 'o', 'W1 Create record (write)'), (rd, '#5b8fd1', 's', 'W2 Read record (evaluate)')]:
    x = [t for t, _ in data]
    ax[0].plot(x, [v['tps'] for _, v in data], marker=mk, color=col, lw=2, label=lab)
    ax[1].plot(x, [v['avgLat'] for _, v in data], marker=mk, color=col, lw=2, label=lab)
ax[0].plot([0, 600], [0, 600], ls='--', color='#9aa6a2', lw=1, label='Ideal (throughput = send rate)')
ax[0].set_xlabel('Target send rate (TPS)'); ax[0].set_ylabel('Achieved throughput (TPS)')
ax[0].set_title('Throughput as offered load rises', loc='left', fontweight='bold'); ax[0].set_ylim(0, 320); ax[0].set_xlim(0, 620)
ax[1].set_yscale('log'); ax[1].set_xlabel('Target send rate (TPS)'); ax[1].set_ylabel('Average latency (s, log scale)')
ax[1].set_title('Latency as offered load rises', loc='left', fontweight='bold'); ax[1].set_xlim(0, 620)
for a in ax: a.legend(fontsize=9, frameon=False, loc='upper left')
fig.tight_layout(); fig.savefig(f'{FIG}/caliper_scalability.png'); plt.close(fig)

# ---------- API comparison ----------
fab = json.load(open(f'{OUT}/api_fabric.json')); cen = json.load(open(f'{OUT}/api_central.json'))
json.dump(fab + cen, open(f'{OUT}/api_comparison.json', 'w'), indent=2)
eps = list(dict.fromkeys(r['endpoint'] for r in fab))
short = ['Create record', 'Audited read', 'Integrity check', 'List records']
fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
import numpy as np
x = np.arange(len(eps)); w = 0.38
for a, key, title, ylab in [(ax[0], 'rps', 'Throughput, 10 concurrent users', 'Requests per second'),
                            (ax[1], 'latAvgMs', 'Average response time, 10 users', 'Milliseconds')]:
    f = [next(r[key] for r in fab if r['endpoint'] == e and r['connections'] == 10) for e in eps]
    c = [next(r[key] for r in cen if r['endpoint'] == e and r['connections'] == 10) for e in eps]
    b1 = a.bar(x - w / 2, f, w, color=TEAL, label='Proposed: T-MERN + Fabric')
    b2 = a.bar(x + w / 2, c, w, color=AMBER, label='Baseline: centralised MERN')
    a.bar_label(b1, fmt='%.0f', fontsize=8.5, padding=2); a.bar_label(b2, fmt='%.0f', fontsize=8.5, padding=2)
    a.set_xticks(x, short); a.set_ylabel(ylab); a.set_title(title, loc='left', fontweight='bold')
ax[0].legend(fontsize=9, frameon=False, loc='upper left')
fig.tight_layout(); fig.savefig(f'{FIG}/api_comparison.png'); plt.close(fig)

# ---------- resource utilisation per round, from the docker stats sampler ----------
from datetime import datetime
def round_windows(path):
    """(label, start_epoch, end_epoch) for each round, from the Caliper manager log."""
    starts, out = {}, []
    for line in open(path):
        m = re.match(r'^(\d{4}\.\d\d\.\d\d-\d\d:\d\d:\d\d\.\d+).*?(Started|Finished) round \d+ \((.+?)\)', re.sub(r'\x1b\[[0-9;]*m', '', line))
        if not m: continue
        t = datetime.strptime(m.group(1), '%Y.%m.%d-%H:%M:%S.%f').timestamp()
        if m.group(2) == 'Started': starts[m.group(3)] = t
        else: out.append((m.group(3), starts.get(m.group(3), t), t))
    return out
def mib(s):
    v, u = re.match(r'([\d.]+)\s*([KMG]i?B)', s).groups(); v = float(v)
    return v / 1024 if u.startswith('K') else v * 1024 if u.startswith('G') else v
samples = []
for line in open(f'{R}/stats.log'):
    ts, js = line.split(' ', 1)
    d = json.loads(js)
    samples.append((float(ts), d['Name'], float(d['CPUPerc'].rstrip('%')), mib(d['MemUsage'].split('/')[0])))
CONTAINERS = ['peer0.org1.example.com', 'peer0.org2.example.com', 'orderer.example.com', 'couchdb0', 'couchdb1', 'peer0org1_ehr_ccaas', 'peer0org2_ehr_ccaas']
res = {}
for p in sorted(glob.glob(f'{R}/main_run[0-9].log')):
    for lab, t0, t1 in round_windows(p):
        if not lab.startswith('W'): continue
        for c in CONTAINERS:
            xs = [(cpu, mem) for t, n, cpu, mem in samples if n == c and t0 <= t <= t1]
            if xs:
                r = res.setdefault(lab, {}).setdefault(c, {'cpu': [], 'mem': []})
                r['cpu'] += [x[0] for x in xs]; r['mem'] += [x[1] for x in xs]
resource = {lab: {c: {'cpuAvg': round(st.mean(v['cpu']), 1), 'cpuMax': round(max(v['cpu']), 1), 'memMaxMiB': round(max(v['mem']), 1), 'samples': len(v['cpu'])}
                  for c, v in d.items()} for lab, d in res.items()}
json.dump(resource, open(f'{OUT}/caliper_resources.json', 'w'), indent=2)
print('ok', len(main), len(wr), len(rd), list(resource))
