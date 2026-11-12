// Security and scenario evaluation against a running API (Fabric or centralised).
// Usage: node security_eval.mjs <label> <baseUrl> <mongoDb> <outJson>
import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';
import fs from 'fs';

const [, , label, BASE, DBNAME, OUT] = process.argv;
const PW = 'Passw0rd!2026';
const mongo = await new MongoClient('mongodb://localhost:27017').connect();
const db = mongo.db(DBNAME);
const out = { system: label };
const now = () => performance.now();

async function call(method, path, token, body) {
  const t0 = now();
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, ms: now() - t0 };
}
async function must(method, path, token, body) {
  const r = await call(method, path, token, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r;
}
const login = async (email) => (await must('POST', '/api/auth/login', null, { email, password: PW })).json.token;
const tok = {
  bello: await login('bello@facility-b.ng'), eke: await login('eke@facility-b.ng'),
  adeyemi: await login('adeyemi@hospital-a.ng'), okafor: await login('okafor@hospital-a.ng'),
  auditor: await login('audit@hospital-a.ng'), admin1: await login('admin@hospital-a.ng'),
};
let pn = 0;
async function newPatient(by = 'bello') {
  pn++;
  const email = `${label}.p${pn}.${Date.now()}@test.ng`;
  const p = (await must('POST', '/api/patients', tok[by], { fullName: `Test Patient ${pn}`, email, password: PW, dateOfBirth: '1990-01-01', sex: 'Female', state: 'Rivers', lga: 'Port Harcourt' })).json;
  return { id: p.patientId, token: await login(email) };
}
async function newRecord(pid, type = 'LAB_RESULT', by = 'bello') {
  return (await must('POST', '/api/records', tok[by], { patientId: pid, recordType: type, title: `${type} test`, content: { value: Math.random().toString(36) } })).json.recordId;
}
const mean = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return +Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length).toFixed(1); };

/* ---------------- T1 integrity: tampering with off-chain data ---------------- */
{
  const P = await newPatient();
  const recs = [];
  for (let i = 0; i < 100; i++) recs.push(await newRecord(P.id));
  // half: an attacker edits the encrypted payload only; other half: an insider with full DB rights edits the payload
  // AND rewrites every hash copy the database holds (record.sha256 and, in the centralised system, the anchor table).
  const flip = (b64) => { const b = Buffer.from(b64, 'base64'); b[0] ^= 0xff; return b.toString('base64'); };
  let i = 0;
  for (const rid of recs) {
    const doc = await db.collection('medicalrecords').findOne({ recordId: rid });
    const ct = flip(doc.sealed.ciphertext);
    const crypto = await import('crypto');
    const newHash = crypto.createHash('sha256').update(`${doc.sealed.iv}.${doc.sealed.tag}.${ct}`).digest('hex');
    await db.collection('medicalrecords').updateOne({ recordId: rid }, { $set: { 'sealed.ciphertext': ct, ...(i >= 50 ? { sha256: newHash } : {}) } });
    if (i >= 50) await db.collection('centralanchors').updateOne({ recordId: rid }, { $set: { sha256: newHash } });
    i++;
  }
  let detPayload = 0, detInsider = 0;
  const detectMs = [];
  for (let j = 0; j < recs.length; j++) {
    const r = await call('GET', `/api/records/${recs[j]}`, P.token);
    detectMs.push(r.ms);
    // 409 = hash mismatch caught; 500 would be an AES-GCM auth-tag failure on decrypt (also a detection, but not hash-based)
    const detected = r.status === 409;
    if (j < 50) detPayload += detected; else detInsider += detected;
  }
  // audit-log tampering by an insider
  const auditColl = label === 'fabric' ? null : db.collection('centralaudits');
  let auditDeleted = 0;
  if (auditColl) auditDeleted = (await auditColl.deleteMany({ patientId: P.id })).deletedCount;
  const auditAfter = (await must('GET', `/api/patients/${P.id}/audit`, P.token)).json.length;
  out.integrity = { injected: 100, payloadOnly: { injected: 50, detected: detPayload }, insiderWithHashRewrite: { injected: 50, detected: detInsider },
    detectionRatePct: detPayload + detInsider, meanCheckMs: mean(detectMs),
    auditLogDeletion: label === 'fabric' ? { attempted: 'no API or DB path deletes ledger entries', eventsStillVisible: auditAfter } : { deletedEvents: auditDeleted, eventsStillVisible: auditAfter } };
  console.log('T1', JSON.stringify(out.integrity));
}

/* ---------------- T2 access-control accuracy ---------------- */
{
  const P = await newPatient('bello');               // Bello gets enrolment consent (ALL)
  const Q = await newPatient('bello');               // a second patient
  const types = ['DIAGNOSIS', 'LAB_RESULT', 'PRESCRIPTION', 'ALLERGY'];
  const recs = [];
  for (const t of types) { recs.push({ id: await newRecord(P.id, t), type: t }); recs.push({ id: await newRecord(P.id, t), type: t }); }
  const past = new Date(Date.now() - 86400000).toISOString();
  const users = await db.collection('users').find({ userId: { $in: ['DOC-OKAFOR', 'DOC-EKE', 'DOC-ADEYEMI'] } }).toArray();
  if (users.length !== 3) throw new Error('missing clinicians');
  await must('POST', '/api/consents', P.token, { granteeId: 'DOC-OKAFOR', scope: 'LAB_RESULT' });    // scoped consent
  await must('POST', '/api/consents', P.token, { granteeId: 'DOC-EKE', scope: 'ALL', expiresAt: past }); // expired consent
  await must('POST', '/api/consents', P.token, { granteeId: 'DOC-ADEYEMI', scope: 'ALL' });          // granted ...
  await must('DELETE', '/api/consents/DOC-ADEYEMI', P.token);                                       // ... then revoked
  const actors = [
    { name: 'patient (owner)', token: P.token, allow: () => true },
    { name: 'enrolling clinician, consent ALL', token: tok.bello, allow: () => true },
    { name: 'clinician, consent LAB_RESULT only', token: tok.okafor, allow: (t) => t === 'LAB_RESULT' },
    { name: 'clinician, expired consent', token: tok.eke, allow: () => false },
    { name: 'clinician, revoked consent', token: tok.adeyemi, allow: () => false },
    { name: 'auditor, no consent', token: tok.auditor, allow: () => false },
    { name: 'another patient', token: Q.token, allow: () => false },
  ];
  let TP = 0, TN = 0, FP = 0, FN = 0; const perActor = {};
  const N = 504; // 72 rounds over the 7 actors
  for (let n = 0; n < N; n++) {
    const a = actors[n % actors.length]; const rec = recs[Math.floor(Math.random() * recs.length)];
    const expected = a.allow(rec.type);
    const r = await call('GET', `/api/records/${rec.id}`, a.token);
    const got = r.status === 200;
    if (expected && got) TP++; else if (!expected && !got) TN++; else if (!expected && got) FP++; else FN++;
    perActor[a.name] = perActor[a.name] ?? { requests: 0, correct: 0 };
    perActor[a.name].requests++; perActor[a.name].correct += (expected === got) ? 1 : 0;
  }
  out.accessControl = { requests: N, TP, TN, FP, FN, accuracyPct: +(100 * (TP + TN) / N).toFixed(2), falseAcceptanceRatePct: +(100 * FP / Math.max(1, FP + TN)).toFixed(2),
    falseRejectionRatePct: +(100 * FN / Math.max(1, FN + TP)).toFixed(2), perActor };
  console.log('T2', JSON.stringify(out.accessControl));

  /* ---------------- T3 API attack tests ---------------- */
  const secret = 'wrong-secret-0123456789';
  const forged = jwt.sign({ userId: 'ADM-ORG1', role: 'admin', org: 'Org1MSP', fullName: 'x' }, secret, { algorithm: 'HS256' });
  const noneAlg = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ userId: 'ADM-ORG1', role: 'admin', org: 'Org1MSP' })).toString('base64url') + '.';
  const expired = jwt.sign({ userId: 'DOC-BELLO', role: 'clinician', org: 'Org2MSP', fullName: 'x', exp: Math.floor(Date.now() / 1000) - 60 }, 'change-me-in-production-0123456789abcdef');
  const attacks = [
    ['No token reads a record', 'GET', `/api/records/${recs[0].id}`, null, null, [401]],
    ['Forged JWT (wrong signing key)', 'GET', '/api/patients', forged, null, [401]],
    ['JWT with alg=none', 'GET', '/api/patients', noneAlg, null, [401]],
    ['Expired JWT', 'GET', '/api/patients', expired, null, [401]],
    ['Patient creates a clinical record', 'POST', '/api/records', P.token, { patientId: P.id, recordType: 'DIAGNOSIS', title: 'self-diagnosis', content: { a: 1 } }, [403]],
    ['Patient lists another patient\'s records', 'GET', `/api/patients/${Q.id}/records`, P.token, null, [403]],
    ['Patient reads another patient\'s audit log', 'GET', `/api/patients/${Q.id}/audit`, P.token, null, [403]],
    ['Clinician grants consent on a patient\'s behalf', 'POST', '/api/consents', tok.adeyemi, { granteeId: 'DOC-ADEYEMI', scope: 'ALL' }, [403]],
    ['Clinician reads the audit trail', 'GET', `/api/patients/${P.id}/audit`, tok.okafor, null, [403]],
    ['Clinician creates staff accounts', 'POST', '/api/staff', tok.bello, { fullName: 'Mallory', email: 'm@x.ng', password: 'Passw0rd!2026', role: 'admin' }, [403]],
    ['NoSQL injection in login', 'POST', '/api/auth/login', null, { email: { $gt: '' }, password: { $gt: '' } }, [400]],
    ['Malformed record hash input (schema validation)', 'POST', '/api/records', tok.bello, { patientId: P.id, recordType: 'NOT_A_TYPE', title: 'x', content: {} }, [400]],
    ['Emergency access without justification', 'POST', `/api/records/${recs[0].id}/emergency`, tok.adeyemi, { justification: 'short' }, [400]],
  ];
  const attackRes = [];
  for (const [name, m, p, t, b, expect] of attacks) {
    const r = await call(m, p, t, b);
    attackRes.push({ test: name, status: r.status, blocked: expect.includes(r.status) });
  }
  out.attacks = attackRes;
  console.log('T3', attackRes.filter(a => a.blocked).length, '/', attackRes.length, 'blocked');
}

/* ---------------- Nigerian scenarios S1-S3 ---------------- */
{
  const S1 = [], S1steps = { denied: [], grant: [], allowed: [] };
  for (let i = 0; i < 10; i++) {
    const P = await newPatient('bello');
    const rid = await newRecord(P.id, 'DIAGNOSIS');
    const a = await call('GET', `/api/records/${rid}`, tok.adeyemi);           // referral doctor, no consent yet
    const g = await call('POST', '/api/consents', P.token, { granteeId: 'DOC-ADEYEMI', scope: 'ALL' });
    const b = await call('GET', `/api/records/${rid}`, tok.adeyemi);
    if (a.status !== 403 || g.status !== 201 || b.status !== 200) throw new Error(`S1 unexpected ${a.status} ${g.status} ${b.status}`);
    S1steps.denied.push(a.ms); S1steps.grant.push(g.ms); S1steps.allowed.push(b.ms); S1.push(a.ms + g.ms + b.ms);
    // S3 on the same patient: revoke and try again
    const rv = await call('DELETE', '/api/consents/DOC-ADEYEMI', P.token);
    const c = await call('GET', `/api/records/${rid}`, tok.adeyemi);
    (out._s3 ??= []).push({ revokeMs: rv.ms, firstAttemptAfterRevoke: c.status });
    // S2 emergency access by an A&E doctor with no consent
    const e = await call('POST', `/api/records/${rid}/emergency`, tok.okafor, { justification: 'Unconscious patient brought into A&E, need history' });
    (out._s2 ??= []).push({ ms: e.ms, status: e.status });
  }
  const P = (await db.collection('patients').find().sort({ _id: -1 }).limit(1).toArray())[0];
  const auditTok = tok.auditor;
  const trail = (await must('GET', `/api/patients/${P.patientId}/audit`, auditTok)).json;
  out.scenarios = {
    S1_referral: { runs: 10, deniedMs: mean(S1steps.denied), grantMs: mean(S1steps.grant), allowedMs: mean(S1steps.allowed), endToEndMs: mean(S1), endToEndSd: sd(S1) },
    S2_emergency: { runs: 10, meanMs: mean(out._s2.map(x => x.ms)), allOpened: out._s2.every(x => x.status === 200), flaggedInAudit: trail.some(e => e.outcome === 'EMERGENCY') },
    S3_revocation: { runs: 10, revokeMs: mean(out._s3.map(x => x.revokeMs)), deniedOnFirstAttempt: out._s3.filter(x => x.firstAttemptAfterRevoke === 403).length },
  };
  delete out._s2; delete out._s3;
  console.log('S', JSON.stringify(out.scenarios));
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
await mongo.close();
