import bcrypt from 'bcryptjs';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import path from 'path';
import { z } from 'zod';
import { config, ORGS } from './config';
import { decrypt, encrypt, sealedHash } from './crypto';
import { Ledger } from './ledger';
import { MedicalRecord, Patient, Role, User } from './models';

interface AuthUser { userId: string; role: Role; org: string; fullName: string; }
interface AuthedRequest extends Request<Record<string, string>> { user?: AuthUser; }

const RECORD_TYPES = ['DIAGNOSIS', 'LAB_RESULT', 'PRESCRIPTION', 'IMAGING', 'VACCINATION', 'ALLERGY', 'DISCHARGE_SUMMARY', 'REFERRAL'] as const;

const newId = (prefix: string) => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

/* ---------- middleware ---------- */

function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { return res.status(401).json({ error: 'Missing bearer token' }); }
  try {
    req.user = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as AuthUser;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const requireRole = (...roles: Role[]) => (req: AuthedRequest, res: Response, next: NextFunction) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });

const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

/* ---------- app ---------- */

export function buildApp(ledger: Ledger) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'self'"] } } }));
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? (process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173']) }));
  app.use(express.json({ limit: '2mb' }));
  if (config.rateLimitPerMinute > 0) {
    app.use('/api', rateLimit({ windowMs: 60_000, limit: config.rateLimitPerMinute, standardHeaders: 'draft-7', legacyHeaders: false }));
  }

  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist, { index: false, dotfiles: 'deny' }));
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', ledger: config.mode, channel: config.channel, facilities: Object.values(ORGS).map(o => ({ msp: o.mspId, name: o.facility })) }));

  /* ---- authentication ---- */
  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
  app.post('/api/auth/login', wrap(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user: any = await User.findOne({ email: body.email.toLowerCase() });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) { return res.status(401).json({ error: 'Invalid email or password' }); }
    const payload: AuthUser = { userId: user.userId, role: user.role, org: user.org, fullName: user.fullName };
    const token = jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtTtl } as jwt.SignOptions);
    res.json({ token, user: payload, facility: ORGS[user.org].facility });
  }));

  app.get('/api/me', authenticate, (req: AuthedRequest, res) => res.json({ user: req.user, facility: ORGS[req.user!.org].facility }));

  /* ---- staff management (admin) ---- */
  const staffSchema = z.object({ fullName: z.string().min(3), email: z.string().email(), password: z.string().min(8),
    role: z.enum(['clinician', 'admin', 'auditor']), specialty: z.string().optional() });
  app.post('/api/staff', authenticate, requireRole('admin'), wrap(async (req, res) => {
    const b = staffSchema.parse(req.body);
    const prefix = b.role === 'clinician' ? 'DOC' : b.role === 'auditor' ? 'AUD' : 'ADM';
    const user: any = await User.create({ userId: newId(prefix), fullName: b.fullName, email: b.email, role: b.role,
      org: req.user!.org as any, specialty: b.specialty, passwordHash: await bcrypt.hash(b.password, 10) });
    res.status(201).json({ userId: user.userId, org: user.org });
  }));

  app.get('/api/staff', authenticate, requireRole('admin'), wrap(async (_req, res) => {
    const staff = await User.find({ role: { $in: ['clinician', 'admin', 'auditor'] } },
      { _id: 0, userId: 1, fullName: 1, role: 1, org: 1, specialty: 1 }).sort({ fullName: 1 }).lean();
    res.json(staff.map((person: any) => ({ ...person, facility: ORGS[person.org].facility })));
  }));

  app.get('/api/clinicians', authenticate, wrap(async (_req, res) => {
    const docs = await User.find({ role: 'clinician' }, { _id: 0, userId: 1, fullName: 1, org: 1, specialty: 1 }).lean();
    res.json(docs.map((d: any) => ({ ...d, facility: ORGS[d.org].facility })));
  }));

  /* ---- patient enrolment (clinician or admin at the home facility) ---- */
  const patientSchema = z.object({ fullName: z.string().min(3), email: z.string().email(), password: z.string().min(8),
    dateOfBirth: z.string(), sex: z.enum(['Female', 'Male']), phone: z.string().optional(), state: z.string().optional(), lga: z.string().optional() });
  app.post('/api/patients', authenticate, requireRole('clinician', 'admin'), wrap(async (req, res) => {
    const b = patientSchema.parse(req.body);
    const patientId = newId('PAT');
    const ledgerRes = await ledger.registerPatient(req.user!.org, patientId);
    await User.create({ userId: patientId, fullName: b.fullName, email: b.email, role: 'patient', org: req.user!.org as any,
      passwordHash: await bcrypt.hash(b.password, 10) });
    await Patient.create({ patientId, userId: patientId, fullName: b.fullName, dateOfBirth: b.dateOfBirth, sex: b.sex,
      phone: b.phone, state: b.state, lga: b.lga, homeOrg: req.user!.org });
    // Consent signed at the registration desk: the enrolling clinician becomes the patient's first authorised carer.
    let consentTxId: string | undefined;
    if (req.user!.role === 'clinician') {
      consentTxId = (await ledger.grant(req.user!.org, patientId, patientId, req.user!.userId, req.user!.org, 'ALL', '')).txId;
    }
    res.status(201).json({ patientId, homeOrg: req.user!.org, ledgerTxId: ledgerRes.txId, enrolmentConsentTxId: consentTxId });
  }));

  app.get('/api/patients', authenticate, requireRole('clinician', 'admin', 'auditor'), wrap(async (_req, res) => {
    res.json(await Patient.find({}, { _id: 0, __v: 0 }).sort({ createdAt: -1 }).lean());
  }));

  /* ---- records ---- */
  const recordSchema = z.object({ patientId: z.string(), recordType: z.enum(RECORD_TYPES), title: z.string().min(3), content: z.record(z.string(), z.any()) });
  app.post('/api/records', authenticate, requireRole('clinician'), wrap(async (req, res) => {
    const b = recordSchema.parse(req.body);
    const recordId = newId('REC');
    const plain = Buffer.from(JSON.stringify(b.content));
    const sealed = encrypt(plain);
    const sha256 = sealedHash(sealed);
    // 1. write the encrypted payload off-chain
    const doc = await MedicalRecord.create({ recordId, patientId: b.patientId, recordType: b.recordType, title: b.title,
      sealed, sha256, authorId: req.user!.userId, authorOrg: req.user!.org, sizeBytes: plain.length });
    // 2. anchor its hash on the ledger (the chaincode decides whether this author may write)
    try {
      const l = await ledger.createRecord(req.user!.org, { recordId, patientId: b.patientId, recordType: b.recordType,
        sha256, offChainRef: String(doc._id), authorId: req.user!.userId });
      if (!l.data.allowed) { await doc.deleteOne(); return res.status(403).json({ error: l.data.reason, ledgerTxId: l.txId }); }
      doc.ledgerTxId = l.txId; await doc.save();
      res.status(201).json({ recordId, sha256, ledgerTxId: l.txId });
    } catch (e) {
      await doc.deleteOne();
      throw e;
    }
  }));

  async function openRecord(recordId: string, ledgerRecord: any) {
    const doc: any = await MedicalRecord.findOne({ recordId }).lean();
    if (!doc) { return { status: 404, body: { error: 'Off-chain record not found' } }; }
    const actualHash = sealedHash(doc.sealed);
    if (actualHash !== ledgerRecord.sha256) {
      return { status: 409, body: { error: 'INTEGRITY_VIOLATION: off-chain record does not match ledger hash', recordId,
        ledgerHash: ledgerRecord.sha256, computedHash: actualHash } };
    }
    const content = JSON.parse(decrypt(doc.sealed).toString());
    return { status: 200, body: { recordId, patientId: doc.patientId, recordType: doc.recordType, title: doc.title, content,
      author: doc.authorId, authorOrg: doc.authorOrg, createdAt: doc.createdAt, integrity: { verified: true, sha256: actualHash, ledgerVersion: ledgerRecord.version } } };
  }

  app.get('/api/records/:id', authenticate, wrap(async (req, res) => {
    const l = await ledger.accessRecord(req.user!.org, req.params.id, req.user!.userId);
    if (!l.data.allowed) { return res.status(403).json({ error: `Access denied: ${l.data.reason}`, ledgerTxId: l.txId }); }
    const r = await openRecord(req.params.id, l.data.record);
    res.status(r.status).json({ ...r.body, ledgerTxId: l.txId });
  }));

  app.post('/api/records/:id/emergency', authenticate, requireRole('clinician'), wrap(async (req, res) => {
    const justification = z.object({ justification: z.string().min(10) }).parse(req.body).justification;
    const l = await ledger.emergencyAccess(req.user!.org, req.params.id, req.user!.userId, justification);
    const r = await openRecord(req.params.id, l.data.record);
    res.status(r.status).json({ ...r.body, emergency: true, ledgerTxId: l.txId });
  }));

  app.get('/api/records/:id/verify', authenticate, wrap(async (req, res) => {
    const doc: any = await MedicalRecord.findOne({ recordId: req.params.id }).lean();
    if (!doc) { return res.status(404).json({ error: 'Not found' }); }
    const l = await ledger.verifyIntegrity(req.user!.org, req.params.id, sealedHash(doc.sealed));
    res.json(l.data);
  }));

  app.get('/api/records/:id/history', authenticate, requireRole('auditor', 'admin', 'clinician'), wrap(async (req, res) => {
    res.json((await ledger.recordHistory(req.user!.org, req.params.id)).data);
  }));

  app.get('/api/patients/:id/records', authenticate, wrap(async (req, res) => {
    if (req.user!.role === 'patient' && req.user!.userId !== req.params.id) { return res.status(403).json({ error: 'Patients may list only their own records' }); }
    const pageSize = Math.min(Number(req.query.pageSize ?? 50) || 50, 200);
    const page = (await ledger.recordsByPatient(req.user!.org, req.params.id, pageSize, String(req.query.bookmark ?? ''))).data as any;
    const ids = page.records.map((a: any) => a.recordId);
    const meta = await MedicalRecord.find({ recordId: { $in: ids } }, { recordId: 1, title: 1, _id: 0 }).lean();
    const titles = new Map(meta.map((m: any) => [m.recordId, m.title]));
    res.json({ bookmark: page.bookmark, count: page.records.length, records: page.records.map((a: any) => ({ recordId: a.recordId, recordType: a.recordType,
      title: titles.get(a.recordId) ?? '', authorId: a.authorId, authorOrg: a.authorOrg, version: a.version, createdAt: a.createdAt, sha256: a.sha256 })) });
  }));

  /* ---- consent ---- */
  const grantSchema = z.object({ granteeId: z.string(), scope: z.enum(['ALL', ...RECORD_TYPES]).default('ALL'), expiresAt: z.string().optional() });
  app.post('/api/consents', authenticate, requireRole('patient'), wrap(async (req, res) => {
    const b = grantSchema.parse(req.body);
    const grantee: any = await User.findOne({ userId: b.granteeId, role: 'clinician' }).lean();
    if (!grantee) { return res.status(404).json({ error: 'Clinician not found' }); }
    const l = await ledger.grant(req.user!.org, req.user!.userId, req.user!.userId, b.granteeId, grantee.org, b.scope, b.expiresAt ?? '');
    res.status(l.data.allowed ? 201 : 403).json({ ...l.data, ledgerTxId: l.txId });
  }));

  app.delete('/api/consents/:granteeId', authenticate, requireRole('patient'), wrap(async (req, res) => {
    const l = await ledger.revoke(req.user!.org, req.user!.userId, req.user!.userId, req.params.granteeId);
    res.status(l.data.allowed ? 200 : 403).json({ ...l.data, ledgerTxId: l.txId });
  }));

  app.get('/api/patients/:id/consents', authenticate, wrap(async (req, res) => {
    if (req.user!.role === 'patient' && req.user!.userId !== req.params.id) { return res.status(403).json({ error: 'Forbidden' }); }
    res.json((await ledger.consents(req.user!.org, req.params.id)).data);
  }));

  /* ---- audit ---- */
  app.get('/api/patients/:id/audit', authenticate, wrap(async (req, res) => {
    const u = req.user!;
    if (u.role === 'patient' && u.userId !== req.params.id) { return res.status(403).json({ error: 'Forbidden' }); }
    if (u.role === 'clinician') { return res.status(403).json({ error: 'Audit trail is visible to the patient, auditors and admins' }); }
    const events = (await ledger.auditTrail(u.org, req.params.id)).data as any[];
    res.json(events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)));
  }));

  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        return next();
      }
      return res.sendFile(path.join(frontendDist, 'index.html'), err => { if (err) { next(err); } });
    });
  }

  /* ---- unknown routes: JSON 404 so the security headers above are kept ---- */
  app.use((_req: Request, res: Response) => { res.status(404).json({ error: 'Not found' }); });

  /* ---- errors ---- */
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) { return res.status(400).json({ error: 'Validation failed', details: err.issues.map(i => `${i.path.join('.')}: ${i.message}`) }); }
    if (err?.code === 11000) { return res.status(409).json({ error: 'Duplicate value' }); }
    const msg = String(err?.details?.[0]?.message ?? err?.message ?? 'Internal error');
    if (/not found/i.test(msg)) { return res.status(404).json({ error: msg.replace(/^.*?message=/, '') }); }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
