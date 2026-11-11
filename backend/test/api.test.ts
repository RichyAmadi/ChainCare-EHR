/**
 * API integration tests. They run the real Express app against MongoDB with the
 * centralised ledger implementation, so they exercise routing, auth, validation,
 * encryption and integrity checks without needing the Fabric network up.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { buildApp } from '../src/app';
import { connectDatabase } from '../src/mongo';
import { decrypt, encrypt, sealedHash } from '../src/crypto';
import { CentralLedger } from '../src/ledger';
import { MedicalRecord, User } from '../src/models';


/* small expect() shim over node:assert */
const expect = (v: any) => ({
  toBe: (e: any) => assert.equal(v, e), toEqual: (e: any) => assert.deepEqual(v, e),
  toBeUndefined: () => assert.equal(v, undefined), toContain: (e: any) => assert.ok(v.includes(e)),
  not: { toBe: (e: any) => assert.notEqual(v, e), toContain: (e: any) => assert.ok(!v.includes(e)) },
});

const PW = 'Passw0rd!2026';
let app: any;
let doc: string, docB: string, adminToken: string;

let stopMongo: (() => Promise<void>) | undefined;

before(async () => {
  const { stop } = await connectDatabase('mongodb://localhost:27017/ehr_jest');
  stopMongo = stop;
  await mongoose.connection.db!.dropDatabase();
  const hash = await bcrypt.hash(PW, 4);
  await User.create([
    { userId: 'DOC-1', fullName: 'Dr One', email: 'one@a.ng', role: 'clinician', org: 'Org1MSP', passwordHash: hash },
    { userId: 'DOC-2', fullName: 'Dr Two', email: 'two@b.ng', role: 'clinician', org: 'Org2MSP', passwordHash: hash },
    { userId: 'AUD-1', fullName: 'Auditor', email: 'aud@a.ng', role: 'auditor', org: 'Org1MSP', passwordHash: hash },
    { userId: 'ADM-1', fullName: 'Administrator', email: 'admin@a.ng', role: 'admin', org: 'Org1MSP', passwordHash: hash },
  ]);
  app = buildApp(new CentralLedger());
  doc = (await request(app).post('/api/auth/login').send({ email: 'one@a.ng', password: PW })).body.token;
  docB = (await request(app).post('/api/auth/login').send({ email: 'two@b.ng', password: PW })).body.token;
  adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin@a.ng', password: PW })).body.token;
});
after(async () => { 
  if (mongoose.connection.db) { await mongoose.connection.db.dropDatabase(); }
  await mongoose.disconnect();
  if (stopMongo) { await stopMongo(); }
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function enrol(email: string) {
  const r = await request(app).post('/api/patients').set(auth(doc)).send({ fullName: 'Ada Eze', email, password: PW, dateOfBirth: '1985-02-01', sex: 'Female' });
  const token = (await request(app).post('/api/auth/login').send({ email, password: PW })).body.token;
  return { id: r.body.patientId as string, token, status: r.status };
}

describe('crypto service', () => {
  test('AES-256-GCM round trip', () => {
    const s = encrypt(Buffer.from('hello'));
    expect(decrypt(s).toString()).toBe('hello');
  });
  test('tampered ciphertext changes the SHA-256 digest', () => {
    const s = encrypt(Buffer.from('hello'));
    const t = { ...s, ciphertext: Buffer.from('x').toString('base64') };
    expect(sealedHash(t)).not.toBe(sealedHash(s));
  });
});

describe('authentication', () => {
  test('health endpoint is public', async () => { expect((await request(app).get('/api/health')).status).toBe(200); });
  test('wrong password is rejected', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'one@a.ng', password: 'wrongpass1' })).status).toBe(401);
  });
  test('protected routes need a token', async () => { expect((await request(app).get('/api/patients')).status).toBe(401); });
  test('staff directory is admin-only and excludes credentials', async () => {
    expect((await request(app).get('/api/staff').set(auth(doc))).status).toBe(403);
    const r = await request(app).get('/api/staff').set(auth(adminToken));
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(4);
    expect(r.body.some((person: any) => person.role === 'auditor')).toBe(true);
    expect(r.body.some((person: any) => person.passwordHash !== undefined || person.email !== undefined)).toBe(false);
  });
  test('security headers are set', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

describe('patients, records and consent', () => {
  test('clinician enrols a patient', async () => { expect((await enrol('p1@x.ng')).status).toBe(201); });

  test('record is stored encrypted and readable by the enrolling clinician', async () => {
    const p = await enrol('p2@x.ng');
    const c = await request(app).post('/api/records').set(auth(doc)).send({ patientId: p.id, recordType: 'DIAGNOSIS', title: 'Malaria', content: { rdt: 'positive' } });
    expect(c.status).toBe(201);
    const stored: any = await MedicalRecord.findOne({ recordId: c.body.recordId }).lean();
    expect(stored.sealed.ciphertext).not.toContain('positive');
    const r = await request(app).get(`/api/records/${c.body.recordId}`).set(auth(doc));
    expect(r.status).toBe(200);
    expect(r.body.content.rdt).toBe('positive');
    expect(r.body.integrity.verified).toBe(true);
  });

  test('clinician at another facility is denied until the patient consents', async () => {
    const p = await enrol('p3@x.ng');
    const c = await request(app).post('/api/records').set(auth(doc)).send({ patientId: p.id, recordType: 'LAB_RESULT', title: 'FBC', content: { hb: 11 } });
    expect((await request(app).get(`/api/records/${c.body.recordId}`).set(auth(docB))).status).toBe(403);
    expect((await request(app).post('/api/consents').set(auth(p.token)).send({ granteeId: 'DOC-2', scope: 'ALL' })).status).toBe(201);
    expect((await request(app).get(`/api/records/${c.body.recordId}`).set(auth(docB))).status).toBe(200);
    expect((await request(app).delete('/api/consents/DOC-2').set(auth(p.token))).status).toBe(200);
    expect((await request(app).get(`/api/records/${c.body.recordId}`).set(auth(docB))).status).toBe(403);
  });

  test('tampered off-chain record returns 409', async () => {
    const p = await enrol('p4@x.ng');
    const c = await request(app).post('/api/records').set(auth(doc)).send({ patientId: p.id, recordType: 'LAB_RESULT', title: 'FBC', content: { hb: 11 } });
    await MedicalRecord.updateOne({ recordId: c.body.recordId }, { $set: { 'sealed.ciphertext': Buffer.from('forged').toString('base64') } });
    expect((await request(app).get(`/api/records/${c.body.recordId}`).set(auth(doc))).status).toBe(409);
  });

  test('patient cannot create clinical records', async () => {
    const p = await enrol('p5@x.ng');
    expect((await request(app).post('/api/records').set(auth(p.token)).send({ patientId: p.id, recordType: 'DIAGNOSIS', title: 'xyz', content: {} })).status).toBe(403);
  });

  test('invalid record type fails validation', async () => {
    const p = await enrol('p6@x.ng');
    expect((await request(app).post('/api/records').set(auth(doc)).send({ patientId: p.id, recordType: 'BAD', title: 'xyz', content: {} })).status).toBe(400);
  });

  test('audit trail is hidden from clinicians but visible to auditors', async () => {
    const p = await enrol('p7@x.ng');
    const aud = (await request(app).post('/api/auth/login').send({ email: 'aud@a.ng', password: PW })).body.token;
    expect((await request(app).get(`/api/patients/${p.id}/audit`).set(auth(doc))).status).toBe(403);
    expect((await request(app).get(`/api/patients/${p.id}/audit`).set(auth(aud))).status).toBe(200);
  });

  test('records list is paginated', async () => {
    const p = await enrol('p8@x.ng');
    for (let i = 0; i < 3; i++) await request(app).post('/api/records').set(auth(doc)).send({ patientId: p.id, recordType: 'LAB_RESULT', title: `Test ${i}`, content: { i } });
    const r = await request(app).get(`/api/patients/${p.id}/records?pageSize=2`).set(auth(doc));
    expect(r.body.count).toBe(2);
    const r2 = await request(app).get(`/api/patients/${p.id}/records?pageSize=2&bookmark=${r.body.bookmark}`).set(auth(doc));
    expect(r2.body.count).toBe(1);
  });
});
