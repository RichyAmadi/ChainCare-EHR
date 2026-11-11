import { EhrContract } from '../src/ehrContract';

/** Minimal in-memory stand-in for the Fabric chaincode stub and client identity. */
function mockCtx(msp = 'Org1MSP') {
  const state = new Map<string, Buffer>();
  const history = new Map<string, Buffer[]>();
  let tx = 0;
  const events: any[] = [];
  const ctx: any = {
    clientIdentity: { getMSPID: () => ctx._msp },
    _msp: msp,
    stub: {
      createCompositeKey: (t: string, a: string[]) => `\u0000${t}\u0000${a.join('\u0000')}\u0000`,
      getState: async (k: string) => state.get(k) ?? Buffer.alloc(0),
      putState: async (k: string, v: Buffer) => { state.set(k, v); history.set(k, [...(history.get(k) ?? []), v]); },
      getTxID: () => `tx${++tx}`,
      getTxTimestamp: () => ({ seconds: Math.floor(Date.now() / 1000), nanos: 0 }),
      setEvent: (n: string, p: Buffer) => events.push({ n, p: JSON.parse(p.toString()) }),
      getStateByPartialCompositeKey: async (t: string, a: string[]) => {
        const prefix = `\u0000${t}\u0000${a.join('\u0000')}\u0000`;
        const items = [...state.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value }));
        let i = 0;
        return { next: async () => (i < items.length ? { value: items[i++], done: false } : { done: true }), close: async () => {} };
      },
    },
  };
  return { ctx, state, events };
}
const H = 'a'.repeat(64);
const parse = (s: string) => JSON.parse(s);

describe('EhrContract', () => {
  let c: EhrContract;
  beforeEach(() => { c = new EhrContract(); });

  test('registers a patient under the calling organisation', async () => {
    const { ctx } = mockCtx('Org2MSP');
    const p = parse(await c.RegisterPatient(ctx, 'PAT-1'));
    expect(p.homeOrg).toBe('Org2MSP');
  });

  test('rejects duplicate patient registration', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await expect(c.RegisterPatient(ctx, 'PAT-1')).rejects.toThrow('already exists');
  });

  test('home facility can anchor a record', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    const r = parse(await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A'));
    expect(r.allowed).toBe(true);
    expect(r.record.version).toBe(1);
  });

  test('rejects a malformed SHA-256 digest', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await expect(c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', 'xyz', 'm1', 'DOC-A')).rejects.toThrow('64-character');
  });

  test('another facility without consent cannot add a record, and the attempt is audited', async () => {
    const { ctx, events } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    ctx._msp = 'Org2MSP';
    const r = parse(await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-B'));
    expect(r.allowed).toBe(false);
    expect(events.at(-1).p.outcome).toBe('DENIED');
  });

  test('only the patient can grant consent', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    const r = parse(await c.GrantAccess(ctx, 'PAT-1', 'DOC-X', 'DOC-X', 'Org1MSP', 'ALL', ''));
    expect(r.allowed).toBe(false);
  });

  test('consent allows access; revocation removes it', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A');
    expect(parse(await c.AccessRecord(ctx, 'REC-1', 'DOC-B')).allowed).toBe(false);
    await c.GrantAccess(ctx, 'PAT-1', 'PAT-1', 'DOC-B', 'Org1MSP', 'ALL', '');
    expect(parse(await c.AccessRecord(ctx, 'REC-1', 'DOC-B')).allowed).toBe(true);
    await c.RevokeAccess(ctx, 'PAT-1', 'PAT-1', 'DOC-B');
    const after = parse(await c.AccessRecord(ctx, 'REC-1', 'DOC-B'));
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe('consent revoked');
  });

  test('scoped consent covers only the named record type', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await c.CreateRecord(ctx, 'REC-LAB', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A');
    await c.CreateRecord(ctx, 'REC-DX', 'PAT-1', 'DIAGNOSIS', H, 'm2', 'DOC-A');
    await c.GrantAccess(ctx, 'PAT-1', 'PAT-1', 'DOC-B', 'Org1MSP', 'LAB_RESULT', '');
    expect(parse(await c.AccessRecord(ctx, 'REC-LAB', 'DOC-B')).allowed).toBe(true);
    expect(parse(await c.AccessRecord(ctx, 'REC-DX', 'DOC-B')).allowed).toBe(false);
  });

  test('expired consent is refused', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A');
    await c.GrantAccess(ctx, 'PAT-1', 'PAT-1', 'DOC-B', 'Org1MSP', 'ALL', '2020-01-01T00:00:00.000Z');
    expect(parse(await c.AccessRecord(ctx, 'REC-1', 'DOC-B')).reason).toBe('consent expired');
  });

  test('consent is bound to the grantee organisation', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A');
    await c.GrantAccess(ctx, 'PAT-1', 'PAT-1', 'DOC-B', 'Org1MSP', 'ALL', '');
    ctx._msp = 'Org2MSP'; // same user id presented through another facility's identity
    expect(parse(await c.AccessRecord(ctx, 'REC-1', 'DOC-B')).allowed).toBe(false);
  });

  test('emergency access needs a justification and is flagged', async () => {
    const { ctx, events } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A');
    await expect(c.EmergencyAccess(ctx, 'REC-1', 'DOC-E', 'short')).rejects.toThrow('justification');
    const r = parse(await c.EmergencyAccess(ctx, 'REC-1', 'DOC-E', 'Unconscious patient in A&E'));
    expect(r.flagged).toBe(true);
    expect(events.at(-1).p.outcome).toBe('EMERGENCY');
  });

  test('integrity check detects a changed hash', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A');
    expect(parse(await c.VerifyIntegrity(ctx, 'REC-1', H)).valid).toBe(true);
    expect(parse(await c.VerifyIntegrity(ctx, 'REC-1', 'b'.repeat(64))).valid).toBe(false);
  });

  test('record update increments the version', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A');
    const u = parse(await c.UpdateRecordHash(ctx, 'REC-1', 'c'.repeat(64), 'm1b', 'DOC-A'));
    expect(u.record.version).toBe(2);
  });

  test('audit trail lists every decision for the patient', async () => {
    const { ctx } = mockCtx();
    await c.RegisterPatient(ctx, 'PAT-1');
    await c.CreateRecord(ctx, 'REC-1', 'PAT-1', 'LAB_RESULT', H, 'm1', 'DOC-A');
    await c.AccessRecord(ctx, 'REC-1', 'DOC-Z');
    const trail = parse(await c.GetAuditTrail(ctx, 'PAT-1'));
    expect(trail.map((e: any) => e.outcome).sort()).toEqual(['ALLOWED', 'DENIED']);
  });
});
