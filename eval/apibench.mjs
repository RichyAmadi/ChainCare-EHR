// Application-layer load test: same endpoints, Fabric-backed API vs centralised MERN baseline.
// Usage: node apibench.mjs <label> <baseUrl> <outJson>
import autocannon from 'autocannon';
import fs from 'fs';

const [, , label, BASE, OUT] = process.argv;
const PW = 'Passw0rd!2026';
const DURATION = Number(process.env.DURATION ?? 15);
const LEVELS = (process.env.LEVELS ?? '10,50').split(',').map(Number);

async function j(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(t)}`);
  return t;
}
const login = async (email) => (await j('POST', '/api/auth/login', null, { email, password: PW })).token;

const doc = await login('bello@facility-b.ng');
const patients = await j('GET', '/api/patients', doc);
const patientId = patients[0].patientId;
// pool of records to read
const ids = [];
for (let i = 0; i < 40; i++) {
  const r = await j('POST', '/api/records', doc, { patientId, recordType: 'LAB_RESULT', title: `Bench lab ${i}`, content: { hb: '12.1 g/dL', wbc: '6.2', note: 'x'.repeat(400) } });
  ids.push(r.recordId);
}
console.log(`[${label}] pool ready: ${ids.length} records for ${patientId}`);

const recordBody = JSON.stringify({ patientId, recordType: 'LAB_RESULT', title: 'Load-test result', content: { hb: '12.1 g/dL', wbc: '6.2 x10^9/L', platelets: '250', note: 'x'.repeat(1500) } });
let k = 0;
const endpoints = [
  { name: 'POST /api/records (create + anchor)', method: 'POST', path: () => '/api/records', body: recordBody },
  { name: 'GET /api/records/:id (audited read)', method: 'GET', path: () => `/api/records/${ids[k++ % ids.length]}` },
  { name: 'GET /api/records/:id/verify (integrity)', method: 'GET', path: () => `/api/records/${ids[k++ % ids.length]}/verify` },
  { name: 'GET /api/patients/:id/records (list)', method: 'GET', path: () => `/api/patients/${patientId}/records` },
];

const results = [];
for (const ep of endpoints) {
  for (const c of LEVELS) {
    const res = await autocannon({
      url: BASE, connections: c, duration: DURATION, timeout: 60,
      requests: [{ method: ep.method, setupRequest: (req) => ({ ...req, path: ep.path(), body: ep.body, headers: { 'content-type': 'application/json', authorization: `Bearer ${doc}` } }) }],
    });
    const total = res.requests.total; const non2xx = res.non2xx + res.errors + res.timeouts;
    const row = { system: label, endpoint: ep.name, connections: c, requests: total, rps: +res.requests.average.toFixed(1),
      latAvgMs: +res.latency.average.toFixed(1), latP50Ms: res.latency.p50, latP90Ms: res.latency.p90, latP99Ms: res.latency.p99, latMaxMs: res.latency.max,
      errors: non2xx, errorRatePct: +(100 * non2xx / Math.max(1, total + res.errors)).toFixed(2) };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
