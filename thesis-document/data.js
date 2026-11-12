// Loads every measured result used in the chapters, plus small formatting helpers.
const fs = require('fs');
const J = (f) => JSON.parse(fs.readFileSync(`/root/ehr/results/${f}`, 'utf8'));

const R = {
  versions: J('versions.json'),
  main: J('caliper_main.json'),
  sweep: J('caliper_scalability.json'),
  resources: J('caliper_resources.json'),
  api: J('api_comparison.json'),
  secF: J('security_fabric.json'),
  secC: J('security_central.json'),
  useF: J('usability_fabric.json'),
  useC: J('usability_central.json'),
  useBefore: J('usability_fabric_before_a11y.json'),
  rate: J('ratelimit.json'),
  auditBefore: ['backend', 'frontend', 'chaincode'].map(p => [p, J(`npm_audit_before_${p}.json`).metadata.vulnerabilities]),
  auditAfter: ['backend', 'frontend', 'chaincode'].map(p => [p, J(`npm_audit_after_${p}.json`).metadata.vulnerabilities]),
  zap: Object.fromEntries(['zap_frontend_before', 'zap_frontend', 'zap_api_before', 'zap_api'].map(f => [f,
    J(`zap/${f}.json`).site.flatMap(s => s.alerts.map(a => ({ name: a.name, risk: a.riskdesc.split(' ')[0], count: +a.count })))])),
  host: J('host.json'),
  tests: { chaincode: fs.readFileSync('/root/ehr/results/chaincode_tests.txt', 'utf8'), api: fs.readFileSync('/root/ehr/results/api_tests.txt', 'utf8') },
};

const f1 = (x) => Number(x).toFixed(1);
const f2 = (x) => Number(x).toFixed(2);
const int = (x) => Math.round(Number(x)).toLocaleString('en-GB');
const ms = (x) => `${int(x)} ms`;
const s2 = (msv) => (Number(msv) / 1000).toFixed(2);
const pm = (pair, d = 1) => `${Number(pair[0]).toFixed(d)} ± ${Number(pair[1]).toFixed(d)}`;
const W = (label) => R.main.find(m => m.workload.startsWith(label));
const api = (system, ep, c) => R.api.find(r => r.system === system && r.endpoint.startsWith(ep) && r.connections === c);
const ratio = (a, b) => (a / b).toFixed(1);

module.exports = { R, f1, f2, int, ms, s2, pm, W, api, ratio };
