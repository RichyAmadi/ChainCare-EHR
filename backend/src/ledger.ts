import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Gateway, hash, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config, ORGS } from './config';
import { CAnchor, CAudit, CConsent, CPatient } from './models';

/**
 * The ledger service is the only part of the backend that knows where trust lives.
 * FabricLedger sends every call to the EhrContract chaincode through the Fabric Gateway.
 * CentralLedger implements the same rules in MongoDB, as the centralised baseline used in evaluation.
 */
export interface LedgerResult<T = any> { data: T; txId?: string; }

export interface Ledger {
  registerPatient(org: string, patientId: string): Promise<LedgerResult>;
  createRecord(org: string, a: { recordId: string; patientId: string; recordType: string; sha256: string; offChainRef: string; authorId: string }): Promise<LedgerResult>;
  updateRecordHash(org: string, recordId: string, sha256: string, offChainRef: string, authorId: string): Promise<LedgerResult>;
  accessRecord(org: string, recordId: string, actorId: string): Promise<LedgerResult>;
  emergencyAccess(org: string, recordId: string, actorId: string, justification: string): Promise<LedgerResult>;
  getAnchor(org: string, recordId: string): Promise<LedgerResult>;
  verifyIntegrity(org: string, recordId: string, sha256: string): Promise<LedgerResult>;
  recordHistory(org: string, recordId: string): Promise<LedgerResult>;
  recordsByPatient(org: string, patientId: string, pageSize?: number, bookmark?: string): Promise<LedgerResult>;
  auditTrail(org: string, patientId: string): Promise<LedgerResult>;
  grant(org: string, patientId: string, actorId: string, granteeId: string, granteeOrg: string, scope: string, expiresAt: string): Promise<LedgerResult>;
  revoke(org: string, patientId: string, actorId: string, granteeId: string): Promise<LedgerResult>;
  consents(org: string, patientId: string): Promise<LedgerResult>;
  close(): Promise<void>;
}

/* ===================================================================== */
/*  Hyperledger Fabric implementation                                     */
/* ===================================================================== */

const utf8 = new TextDecoder();

function firstFile(dir: string): string {
  if (fs.statSync(dir).isFile()) {
    return dir;
  }
  const f = fs.readdirSync(dir).sort()[0];
  if (!f) {
    throw new Error(`Fabric identity directory is empty: ${dir}`);
  }
  return path.join(dir, f);
}

export class FabricLedger implements Ledger {
  private gateways: Gateway[] = [];
  private clients: grpc.Client[] = [];
  private contracts: Record<string, Contract> = {};

  async init(): Promise<void> {
    for (const org of Object.values(ORGS)) {
      const tlsRootCert = fs.readFileSync(org.tlsCertPath);
      const client = new grpc.Client(org.peerEndpoint, grpc.credentials.createSsl(tlsRootCert), {
        'grpc.ssl_target_name_override': org.peerHostAlias,
      });
      const identity: Identity = { mspId: org.mspId, credentials: fs.readFileSync(firstFile(org.certDir)) };
      const privateKey = crypto.createPrivateKey(fs.readFileSync(firstFile(org.keyDir)));
      const signer: Signer = signers.newPrivateKeySigner(privateKey);
      const gateway = connect({
        client, identity, signer, hash: hash.sha256,
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        endorseOptions: () => ({ deadline: Date.now() + 15000 }),
        submitOptions: () => ({ deadline: Date.now() + 5000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
      });
      this.clients.push(client);
      this.gateways.push(gateway);
      this.contracts[org.mspId] = gateway.getNetwork(config.channel).getContract(config.chaincode);
    }
  }

  private c(org: string): Contract {
    const contract = this.contracts[org];
    if (!contract) { throw new Error(`Unknown organisation ${org}`); }
    return contract;
  }

  private async submit(org: string, fn: string, ...args: string[]): Promise<LedgerResult> {
    const proposal = this.c(org).newProposal(fn, { arguments: args });
    const tx = await proposal.endorse();
    const commit = await tx.submit();
    const status = await commit.getStatus();
    if (!status.successful) { throw new Error(`Transaction ${status.transactionId} failed with status ${status.code}`); }
    return { data: JSON.parse(utf8.decode(tx.getResult())), txId: status.transactionId };
  }

  private async evaluate(org: string, fn: string, ...args: string[]): Promise<LedgerResult> {
    const result = await this.c(org).evaluateTransaction(fn, ...args);
    return { data: JSON.parse(utf8.decode(result)) };
  }

  registerPatient(org: string, patientId: string) { return this.submit(org, 'RegisterPatient', patientId); }
  createRecord(org: string, a: any) { return this.submit(org, 'CreateRecord', a.recordId, a.patientId, a.recordType, a.sha256, a.offChainRef, a.authorId); }
  updateRecordHash(org: string, r: string, h: string, ref: string, au: string) { return this.submit(org, 'UpdateRecordHash', r, h, ref, au); }
  accessRecord(org: string, r: string, actor: string) { return this.submit(org, 'AccessRecord', r, actor); }
  emergencyAccess(org: string, r: string, actor: string, j: string) { return this.submit(org, 'EmergencyAccess', r, actor, j); }
  getAnchor(org: string, r: string) { return this.evaluate(org, 'GetRecordAnchor', r); }
  verifyIntegrity(org: string, r: string, h: string) { return this.evaluate(org, 'VerifyIntegrity', r, h); }
  recordHistory(org: string, r: string) { return this.evaluate(org, 'GetRecordHistory', r); }
  recordsByPatient(org: string, p: string, size = 50, bm = '') { return this.evaluate(org, 'QueryRecordsByPatient', p, String(size), bm); }
  auditTrail(org: string, p: string) { return this.evaluate(org, 'GetAuditTrail', p); }
  grant(org: string, p: string, a: string, g: string, go: string, s: string, e: string) { return this.submit(org, 'GrantAccess', p, a, g, go, s, e); }
  revoke(org: string, p: string, a: string, g: string) { return this.submit(org, 'RevokeAccess', p, a, g); }
  consents(org: string, p: string) { return this.evaluate(org, 'GetConsents', p); }

  async close(): Promise<void> {
    this.gateways.forEach(g => g.close());
    this.clients.forEach(c => c.close());
  }
}

/* ===================================================================== */
/*  Centralised baseline: same rules, one MongoDB database, mutable logs  */
/* ===================================================================== */

export class CentralLedger implements Ledger {
  private now() { return new Date().toISOString(); }
  private id() { return crypto.randomBytes(32).toString('hex'); }

  private async audit(org: string, e: any) {
    const txId = this.id();
    await CAudit.create({ txId, actorOrg: org, timestamp: this.now(), ...e });
    return txId;
  }

  private async authorised(org: string, actorId: string, patientId: string, recordType: string) {
    if (actorId === patientId) { return { ok: true, reason: 'owner' }; }
    const c: any = await CConsent.findOne({ patientId, granteeId: actorId }).lean();
    if (!c) { return { ok: false, reason: 'no consent' }; }
    if (c.status !== 'ACTIVE') { return { ok: false, reason: 'consent revoked' }; }
    if (c.granteeOrg !== org) { return { ok: false, reason: 'caller organisation does not match consent' }; }
    if (c.expiresAt && c.expiresAt < this.now()) { return { ok: false, reason: 'consent expired' }; }
    if (c.scope !== 'ALL' && c.scope !== recordType) { return { ok: false, reason: 'record type outside consent scope' }; }
    return { ok: true, reason: 'active consent' };
  }

  async registerPatient(org: string, patientId: string) {
    const p = await CPatient.create({ patientId, homeOrg: org, createdAt: this.now() });
    return { data: p.toObject(), txId: this.id() };
  }

  async createRecord(org: string, a: any) {
    const p: any = await CPatient.findOne({ patientId: a.patientId }).lean();
    if (!p) { throw new Error(`Patient ${a.patientId} not found`); }
    const auth = p.homeOrg === org ? { ok: true, reason: 'home facility' } : await this.authorised(org, a.authorId, a.patientId, a.recordType);
    if (!auth.ok) {
      const txId = await this.audit(org, { action: 'CREATE_RECORD', actorId: a.authorId, patientId: a.patientId, recordId: a.recordId, outcome: 'DENIED', reason: auth.reason });
      return { data: { allowed: false, reason: auth.reason }, txId };
    }
    const now = this.now();
    const rec = await CAnchor.create({ ...a, authorOrg: org, version: 1, createdAt: now, updatedAt: now });
    const txId = await this.audit(org, { action: 'CREATE_RECORD', actorId: a.authorId, patientId: a.patientId, recordId: a.recordId, outcome: 'ALLOWED' });
    return { data: { allowed: true, record: rec.toObject() }, txId };
  }

  async updateRecordHash(org: string, recordId: string, sha256: string, offChainRef: string, authorId: string) {
    const rec: any = await CAnchor.findOne({ recordId });
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    rec.sha256 = sha256; rec.offChainRef = offChainRef; rec.version += 1; rec.updatedAt = this.now(); rec.authorId = authorId;
    await rec.save();
    const txId = await this.audit(org, { action: 'UPDATE_RECORD', actorId: authorId, patientId: rec.patientId, recordId, outcome: 'ALLOWED' });
    return { data: { allowed: true, record: rec.toObject() }, txId };
  }

  async accessRecord(org: string, recordId: string, actorId: string) {
    const rec: any = await CAnchor.findOne({ recordId }).lean();
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    const auth = await this.authorised(org, actorId, rec.patientId, rec.recordType);
    const txId = await this.audit(org, { action: 'ACCESS_RECORD', actorId, patientId: rec.patientId, recordId, outcome: auth.ok ? 'ALLOWED' : 'DENIED', reason: auth.reason });
    return { data: auth.ok ? { allowed: true, record: rec } : { allowed: false, reason: auth.reason }, txId };
  }

  async emergencyAccess(org: string, recordId: string, actorId: string, justification: string) {
    const rec: any = await CAnchor.findOne({ recordId }).lean();
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    const txId = await this.audit(org, { action: 'EMERGENCY_ACCESS', actorId, patientId: rec.patientId, recordId, outcome: 'EMERGENCY', reason: justification });
    return { data: { allowed: true, flagged: true, record: rec }, txId };
  }

  async getAnchor(_org: string, recordId: string) {
    const rec = await CAnchor.findOne({ recordId }).lean();
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    return { data: rec };
  }

  async verifyIntegrity(_org: string, recordId: string, sha256: string) {
    const rec: any = await CAnchor.findOne({ recordId }).lean();
    return { data: { recordId, valid: rec?.sha256 === sha256, ledgerHash: rec?.sha256, version: rec?.version } };
  }

  async recordHistory(_org: string, recordId: string) {
    return { data: await CAudit.find({ recordId }).lean() };
  }
  async recordsByPatient(_org: string, patientId: string, size = 50, bookmark = '') {
    const skip = Number(bookmark || 0);
    const records = await CAnchor.find({ patientId }).sort({ _id: 1 }).skip(skip).limit(size).lean();
    return { data: { records, bookmark: String(skip + records.length), fetched: records.length } };
  }
  async auditTrail(_org: string, patientId: string) {
    return { data: await CAudit.find({ patientId }).lean() };
  }

  async grant(org: string, patientId: string, actorId: string, granteeId: string, granteeOrg: string, scope: string, expiresAt: string) {
    if (actorId !== patientId) { return { data: { allowed: false, reason: 'only the patient can grant consent' } }; }
    const c = await CConsent.findOneAndUpdate({ patientId, granteeId },
      { patientId, granteeId, granteeOrg, scope: scope || 'ALL', status: 'ACTIVE', expiresAt: expiresAt || '', grantedAt: this.now() },
      { upsert: true, new: true }).lean();
    const txId = await this.audit(org, { action: 'GRANT_ACCESS', actorId, patientId, outcome: 'ALLOWED' });
    return { data: { allowed: true, consent: c }, txId };
  }

  async revoke(org: string, patientId: string, actorId: string, granteeId: string) {
    if (actorId !== patientId) { return { data: { allowed: false, reason: 'only the patient can revoke consent' } }; }
    const c = await CConsent.findOneAndUpdate({ patientId, granteeId }, { status: 'REVOKED', revokedAt: this.now() }, { new: true }).lean();
    const txId = await this.audit(org, { action: 'REVOKE_ACCESS', actorId, patientId, outcome: 'ALLOWED' });
    return { data: { allowed: true, consent: c }, txId };
  }

  async consents(_org: string, patientId: string) {
    return { data: await CConsent.find({ patientId }).lean() };
  }

  async close() { /* nothing to close */ }
}

export async function createLedger(): Promise<Ledger> {
  if (config.mode === 'centralised') { return new CentralLedger(); }
  const l = new FabricLedger();
  await l.init();
  return l;
}
