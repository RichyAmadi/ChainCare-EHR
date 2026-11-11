import { Context, Contract, Info, Transaction, Returns } from 'fabric-contract-api';

/* ------------------------------------------------------------------
 * Data types stored in the world state (CouchDB)
 * ------------------------------------------------------------------ */
interface Patient {
  docType: 'patient';
  patientId: string;
  homeOrg: string;      // MSP of the facility that registered the patient
  createdAt: string;
}

interface RecordAnchor {
  docType: 'record';
  recordId: string;
  patientId: string;
  recordType: string;   // e.g. LAB_RESULT, DIAGNOSIS, PRESCRIPTION
  sha256: string;       // hash of the encrypted off-chain file in MongoDB
  offChainRef: string;  // MongoDB / GridFS document id
  authorId: string;
  authorOrg: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface Consent {
  docType: 'consent';
  patientId: string;
  granteeId: string;
  granteeOrg: string;
  scope: string;        // ALL or a record type, e.g. LAB_RESULT
  status: 'ACTIVE' | 'REVOKED';
  expiresAt: string;    // ISO date, '' = no expiry
  grantedAt: string;
  revokedAt?: string;
}

interface AuditEvent {
  docType: 'audit';
  txId: string;
  action: string;
  actorId: string;
  actorOrg: string;
  patientId: string;
  recordId?: string;
  outcome: 'ALLOWED' | 'DENIED' | 'EMERGENCY';
  reason?: string;
  timestamp: string;
}

@Info({ title: 'EhrContract', description: 'Patient consent, access control and audit for the blockchain EHR system' })
export class EhrContract extends Contract {

  /* ---------------- helpers ---------------- */

  private txTime(ctx: Context): string {
    const ts = ctx.stub.getTxTimestamp();
    const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6);
    return new Date(ms).toISOString();
  }

  private callerOrg(ctx: Context): string {
    return ctx.clientIdentity.getMSPID();
  }

  private async getJson<T>(ctx: Context, key: string): Promise<T | null> {
    const data = await ctx.stub.getState(key);
    if (!data || data.length === 0) { return null; }
    return JSON.parse(data.toString()) as T;
  }

  private async putJson(ctx: Context, key: string, value: object): Promise<void> {
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
  }

  private consentKey(ctx: Context, patientId: string, granteeId: string): string {
    return ctx.stub.createCompositeKey('consent', [patientId, granteeId]);
  }

  private async writeAudit(ctx: Context, e: Omit<AuditEvent, 'docType' | 'txId' | 'timestamp' | 'actorOrg'>): Promise<AuditEvent> {
    const txId = ctx.stub.getTxID();
    const event: AuditEvent = { docType: 'audit', txId, timestamp: this.txTime(ctx), actorOrg: this.callerOrg(ctx), ...e };
    await this.putJson(ctx, ctx.stub.createCompositeKey('audit', [e.patientId, txId]), event);
    ctx.stub.setEvent('EhrAudit', Buffer.from(JSON.stringify(event)));
    return event;
  }

  /** Decide whether an actor may see a record of a patient. */
  private async isAuthorised(ctx: Context, actorId: string, patient: Patient, recordType: string): Promise<{ ok: boolean; reason: string }> {
    if (actorId === patient.patientId) { return { ok: true, reason: 'owner' }; }
    const consent = await this.getJson<Consent>(ctx, this.consentKey(ctx, patient.patientId, actorId));
    if (!consent) { return { ok: false, reason: 'no consent on ledger' }; }
    if (consent.status !== 'ACTIVE') { return { ok: false, reason: 'consent revoked' }; }
    if (consent.granteeOrg !== this.callerOrg(ctx)) { return { ok: false, reason: 'caller organisation does not match consent' }; }
    if (consent.expiresAt && consent.expiresAt < this.txTime(ctx)) { return { ok: false, reason: 'consent expired' }; }
    if (consent.scope !== 'ALL' && consent.scope !== recordType) { return { ok: false, reason: 'record type outside consent scope' }; }
    return { ok: true, reason: 'active consent' };
  }

  /* ---------------- patient registration ---------------- */

  @Transaction()
  public async RegisterPatient(ctx: Context, patientId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey('patient', [patientId]);
    if (await this.getJson<Patient>(ctx, key)) { throw new Error(`Patient ${patientId} already exists`); }
    const p: Patient = { docType: 'patient', patientId, homeOrg: this.callerOrg(ctx), createdAt: this.txTime(ctx) };
    await this.putJson(ctx, key, p);
    return JSON.stringify(p);
  }

  private async mustGetPatient(ctx: Context, patientId: string): Promise<Patient> {
    const p = await this.getJson<Patient>(ctx, ctx.stub.createCompositeKey('patient', [patientId]));
    if (!p) { throw new Error(`Patient ${patientId} not found`); }
    return p;
  }

  /* ---------------- records ---------------- */

  @Transaction()
  public async CreateRecord(ctx: Context, recordId: string, patientId: string, recordType: string,
    sha256: string, offChainRef: string, authorId: string): Promise<string> {
    const patient = await this.mustGetPatient(ctx, patientId);
    const key = ctx.stub.createCompositeKey('record', [recordId]);
    if (await this.getJson<RecordAnchor>(ctx, key)) { throw new Error(`Record ${recordId} already exists`); }
    if (!/^[a-f0-9]{64}$/.test(sha256)) { throw new Error('sha256 must be a 64-character hex digest'); }
    // Providers in the patient's home facility, or providers with consent, may add records.
    const homeProvider = this.callerOrg(ctx) === patient.homeOrg;
    const auth = homeProvider ? { ok: true, reason: 'home facility' } : await this.isAuthorised(ctx, authorId, patient, recordType);
    if (!auth.ok) {
      await this.writeAudit(ctx, { action: 'CREATE_RECORD', actorId: authorId, patientId, recordId, outcome: 'DENIED', reason: auth.reason });
      return JSON.stringify({ allowed: false, reason: auth.reason });
    }
    const now = this.txTime(ctx);
    const rec: RecordAnchor = { docType: 'record', recordId, patientId, recordType, sha256, offChainRef,
      authorId, authorOrg: this.callerOrg(ctx), version: 1, createdAt: now, updatedAt: now };
    await this.putJson(ctx, key, rec);
    await this.writeAudit(ctx, { action: 'CREATE_RECORD', actorId: authorId, patientId, recordId, outcome: 'ALLOWED', reason: auth.reason });
    return JSON.stringify({ allowed: true, record: rec });
  }

  @Transaction()
  public async UpdateRecordHash(ctx: Context, recordId: string, sha256: string, offChainRef: string, authorId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey('record', [recordId]);
    const rec = await this.getJson<RecordAnchor>(ctx, key);
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    const patient = await this.mustGetPatient(ctx, rec.patientId);
    const homeProvider = this.callerOrg(ctx) === patient.homeOrg;
    const auth = homeProvider ? { ok: true, reason: 'home facility' } : await this.isAuthorised(ctx, authorId, patient, rec.recordType);
    if (!auth.ok) {
      await this.writeAudit(ctx, { action: 'UPDATE_RECORD', actorId: authorId, patientId: rec.patientId, recordId, outcome: 'DENIED', reason: auth.reason });
      return JSON.stringify({ allowed: false, reason: auth.reason });
    }
    rec.sha256 = sha256; rec.offChainRef = offChainRef; rec.version += 1; rec.updatedAt = this.txTime(ctx);
    rec.authorId = authorId; rec.authorOrg = this.callerOrg(ctx);
    await this.putJson(ctx, key, rec);
    await this.writeAudit(ctx, { action: 'UPDATE_RECORD', actorId: authorId, patientId: rec.patientId, recordId, outcome: 'ALLOWED' });
    return JSON.stringify({ allowed: true, record: rec });
  }

  /** Audited read: goes through ordering so every access attempt lands on the ledger. */
  @Transaction()
  public async AccessRecord(ctx: Context, recordId: string, actorId: string): Promise<string> {
    const rec = await this.getJson<RecordAnchor>(ctx, ctx.stub.createCompositeKey('record', [recordId]));
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    const patient = await this.mustGetPatient(ctx, rec.patientId);
    const auth = await this.isAuthorised(ctx, actorId, patient, rec.recordType);
    await this.writeAudit(ctx, { action: 'ACCESS_RECORD', actorId, patientId: rec.patientId, recordId,
      outcome: auth.ok ? 'ALLOWED' : 'DENIED', reason: auth.reason });
    return JSON.stringify(auth.ok ? { allowed: true, record: rec } : { allowed: false, reason: auth.reason });
  }

  /** Break-glass access for emergencies: always allowed, always flagged for review. */
  @Transaction()
  public async EmergencyAccess(ctx: Context, recordId: string, actorId: string, justification: string): Promise<string> {
    if (!justification || justification.trim().length < 10) { throw new Error('An emergency justification of at least 10 characters is required'); }
    const rec = await this.getJson<RecordAnchor>(ctx, ctx.stub.createCompositeKey('record', [recordId]));
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    await this.writeAudit(ctx, { action: 'EMERGENCY_ACCESS', actorId, patientId: rec.patientId, recordId, outcome: 'EMERGENCY', reason: justification });
    return JSON.stringify({ allowed: true, flagged: true, record: rec });
  }

  /** Unaudited lookup used by the backend for integrity checks (evaluate only). */
  @Transaction(false)
  @Returns('string')
  public async GetRecordAnchor(ctx: Context, recordId: string): Promise<string> {
    const rec = await this.getJson<RecordAnchor>(ctx, ctx.stub.createCompositeKey('record', [recordId]));
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    return JSON.stringify(rec);
  }

  @Transaction(false)
  public async VerifyIntegrity(ctx: Context, recordId: string, sha256: string): Promise<string> {
    const rec = await this.getJson<RecordAnchor>(ctx, ctx.stub.createCompositeKey('record', [recordId]));
    if (!rec) { throw new Error(`Record ${recordId} not found`); }
    return JSON.stringify({ recordId, valid: rec.sha256 === sha256, ledgerHash: rec.sha256, version: rec.version });
  }

  @Transaction(false)
  public async GetRecordHistory(ctx: Context, recordId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey('record', [recordId]);
    const iter = await ctx.stub.getHistoryForKey(key);
    const out: object[] = [];
    let r = await iter.next();
    while (!r.done) {
      const ts = r.value.timestamp;
      out.push({ txId: r.value.txId, timestamp: new Date(Number(ts.seconds) * 1000).toISOString(),
        isDelete: r.value.isDelete, value: r.value.value.length ? JSON.parse(Buffer.from(r.value.value).toString()) : null });
      r = await iter.next();
    }
    await iter.close();
    return JSON.stringify(out);
  }

  /** Paginated CouchDB rich query (v1.1). An unpaginated query timed out for patients with ~900 records. */
  @Transaction(false)
  public async QueryRecordsByPatient(ctx: Context, patientId: string, pageSize: string, bookmark: string): Promise<string> {
    const size = Math.min(Math.max(parseInt(pageSize || '50', 10) || 50, 1), 200);
    const query = JSON.stringify({ selector: { docType: 'record', patientId }, use_index: ['_design/indexPatientDoc', 'indexPatient'] });
    const { iterator, metadata } = await ctx.stub.getQueryResultWithPagination(query, size, bookmark || '');
    const records: object[] = [];
    let r = await iterator.next();
    while (!r.done) { records.push(JSON.parse(Buffer.from(r.value.value).toString())); r = await iterator.next(); }
    await iterator.close();
    return JSON.stringify({ records, bookmark: metadata.bookmark, fetched: metadata.fetchedRecordsCount });
  }

  @Transaction(false)
  public async GetAuditTrail(ctx: Context, patientId: string): Promise<string> {
    const iter = await ctx.stub.getStateByPartialCompositeKey('audit', [patientId]);
    const out: object[] = [];
    let r = await iter.next();
    while (!r.done) { out.push(JSON.parse(Buffer.from(r.value.value).toString())); r = await iter.next(); }
    await iter.close();
    return JSON.stringify(out);
  }

  private async collect(ctx: Context, query: string): Promise<string> {
    const iter = await ctx.stub.getQueryResult(query);
    const out: object[] = [];
    let r = await iter.next();
    while (!r.done) { out.push(JSON.parse(Buffer.from(r.value.value).toString())); r = await iter.next(); }
    await iter.close();
    return JSON.stringify(out);
  }

  /* ---------------- consent ---------------- */

  @Transaction()
  public async GrantAccess(ctx: Context, patientId: string, actorId: string, granteeId: string,
    granteeOrg: string, scope: string, expiresAt: string): Promise<string> {
    await this.mustGetPatient(ctx, patientId);
    if (actorId !== patientId) {
      await this.writeAudit(ctx, { action: 'GRANT_ACCESS', actorId, patientId, outcome: 'DENIED', reason: 'only the patient can grant consent' });
      return JSON.stringify({ allowed: false, reason: 'only the patient can grant consent' });
    }
    const c: Consent = { docType: 'consent', patientId, granteeId, granteeOrg, scope: scope || 'ALL',
      status: 'ACTIVE', expiresAt: expiresAt || '', grantedAt: this.txTime(ctx) };
    await this.putJson(ctx, this.consentKey(ctx, patientId, granteeId), c);
    await this.writeAudit(ctx, { action: 'GRANT_ACCESS', actorId, patientId, outcome: 'ALLOWED', reason: `${granteeId}@${granteeOrg} scope=${c.scope}` });
    return JSON.stringify({ allowed: true, consent: c });
  }

  @Transaction()
  public async RevokeAccess(ctx: Context, patientId: string, actorId: string, granteeId: string): Promise<string> {
    if (actorId !== patientId) {
      await this.writeAudit(ctx, { action: 'REVOKE_ACCESS', actorId, patientId, outcome: 'DENIED', reason: 'only the patient can revoke consent' });
      return JSON.stringify({ allowed: false, reason: 'only the patient can revoke consent' });
    }
    const key = this.consentKey(ctx, patientId, granteeId);
    const c = await this.getJson<Consent>(ctx, key);
    if (!c) { throw new Error(`No consent for ${granteeId}`); }
    c.status = 'REVOKED'; c.revokedAt = this.txTime(ctx);
    await this.putJson(ctx, key, c);
    await this.writeAudit(ctx, { action: 'REVOKE_ACCESS', actorId, patientId, outcome: 'ALLOWED', reason: granteeId });
    return JSON.stringify({ allowed: true, consent: c });
  }

  @Transaction(false)
  public async GetConsents(ctx: Context, patientId: string): Promise<string> {
    const iter = await ctx.stub.getStateByPartialCompositeKey('consent', [patientId]);
    const out: object[] = [];
    let r = await iter.next();
    while (!r.done) { out.push(JSON.parse(Buffer.from(r.value.value).toString())); r = await iter.next(); }
    await iter.close();
    return JSON.stringify(out);
  }
}
