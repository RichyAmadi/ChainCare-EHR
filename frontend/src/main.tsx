import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, fmtDate, getSession, ORG_LABEL, pretty, RECORD_TYPES, Session, setSession, shortHash } from './api';
import './styles.css';

/* ======================= shared pieces ======================= */

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; setData(null); setError(''); fn().then(d => live && setData(d)).catch(e => live && setError(e.message)); return () => { live = false; }; }, [...deps, tick]);
  return { data, error, reload: () => setTick(t => t + 1) };
}

function Outcome({ o }: { o: string }) {
  const cls = o === 'ALLOWED' ? 'ok' : o === 'DENIED' ? 'bad' : 'warn';
  return <span className={`badge ${cls}`}>{o}</span>;
}

function RecordViewer({ recordId, onClose, allowEmergency }: { recordId: string; onClose: () => void; allowEmergency?: boolean }) {
  const [rec, setRec] = useState<any>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [just, setJust] = useState('');
  useEffect(() => {
    let live = true;
    setRec(null); setErr(null);
    api(`/records/${encodeURIComponent(recordId)}`).then(result => { if (live) setRec(result); }).catch(error => { if (live) setErr(error); });
    return () => { live = false; };
  }, [recordId]);
  const emergency = () => api(`/records/${recordId}/emergency`, { body: { justification: just } }).then(r => { setErr(null); setRec(r); }).catch(setErr);
  return (
    <div className="card" data-testid="record-viewer">
      <div className="row"><h2>Record {recordId}</h2><div className="spacer" /><button className="secondary" onClick={onClose}>Close</button></div>
      {err && <div className={`alert ${err.status === 409 ? 'bad' : 'warn'}`}>
        <b>{err.status === 409 ? 'Integrity check failed. ' : ''}</b>{err.message}
        {err.body?.ledgerTxId && <div className="mono">Logged on ledger: tx {shortHash(err.body.ledgerTxId)}</div>}
      </div>}
      {err?.status === 403 && allowEmergency && <div>
        <label>Emergency (break-glass) access — reason is recorded on the ledger and the patient is notified</label>
        <div className="row"><input className="flex-input" aria-label="Emergency access justification" value={just} onChange={e => setJust(e.target.value)} placeholder="e.g. Unconscious patient in A&E, need allergy history" />
          <button className="danger" disabled={just.length < 10} onClick={emergency}>Break glass</button></div>
      </div>}
      {!rec && !err && <p className="loading">Opening record and verifying ledger integrity…</p>}
      {rec && <>
        {rec.emergency && <div className="alert warn">Opened under emergency access. This access is flagged for review.</div>}
        <div className="alert ok">Integrity verified: off-chain hash matches the ledger (version {rec.integrity.ledgerVersion}).</div>
        <div className="kv">
          <div>Title</div><div><b>{rec.title}</b></div>
          <div>Type</div><div>{pretty(rec.recordType)}</div>
          <div>Patient</div><div className="mono">{rec.patientId}</div>
          <div>Author</div><div>{rec.author} · {ORG_LABEL[rec.authorOrg]}</div>
          <div>Created</div><div>{fmtDate(rec.createdAt)}</div>
          <div>SHA-256 (on ledger)</div><div className="mono">{rec.integrity.sha256}</div>
          <div>Access tx</div><div className="mono">{rec.ledgerTxId}</div>
        </div>
        <h3 className="section-subhead">Clinical content (decrypted)</h3>
        <table><tbody>{Object.entries(rec.content).map(([k, v]) => <tr key={k}><th className="clinical-field">{k}</th><td>{String(v)}</td></tr>)}</tbody></table>
      </>}
    </div>
  );
}

function RecordList({ patientId, onOpen }: { patientId: string; onOpen: (id: string) => void }) {
  const [bookmarks, setBookmarks] = useState(['']);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => { setBookmarks(['']); setPage(0); setQuery(''); }, [patientId]);
  const bookmark = bookmarks[page] ?? '';
  const { data, error } = useLoad<any>(() => api(`/patients/${patientId}/records?pageSize=25&bookmark=${encodeURIComponent(bookmark)}`), [patientId, bookmark]);
  if (error) { return <div className="alert bad">{error}</div>; }
  if (!data) { return <p className="loading">Loading records from the ledger…</p>; }
  const records = (data.records ?? []).filter((r: any) => !query || `${r.title} ${r.recordType} ${r.authorId}`.toLowerCase().includes(query.toLowerCase()));
  if (!data.records?.length && page === 0) { return <div className="empty-state"><b>No records yet</b>Clinical records will appear here when they are added.</div>; }
  return <>
    <div className="row row-spaced">
      <input className="search-input" aria-label="Filter records on this page" placeholder="Filter this page by title, type or author" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="spacer" />
      <span className="muted">Page {page + 1} · {data.count} records</span>
      <button className="secondary" disabled={page === 0} onClick={() => setPage(current => current - 1)}>Previous</button>
      <button className="secondary" disabled={!data.bookmark} onClick={() => {
        setBookmarks(current => [...current.slice(0, page + 1), data.bookmark]);
        setPage(current => current + 1);
      }}>Next</button>
    </div>
    {!records.length ? <div className="empty-state"><b>No matches on this page</b>Try another search term or move to another page.</div> :
      <div className="table-wrap"><table>
        <thead><tr><th>Record</th><th>Type</th><th>Author</th><th>Facility</th><th>Created</th><th>Ledger hash</th><th></th></tr></thead>
        <tbody>{records.map((r: any) => <tr key={r.recordId}>
          <td><b>{r.title || 'Untitled record'}</b><div className="mono muted">{r.recordId}</div></td><td>{pretty(r.recordType)}</td><td>{r.authorId}</td>
          <td>{ORG_LABEL[r.authorOrg] ?? r.authorOrg}</td><td>{fmtDate(r.createdAt)}</td><td className="mono">{shortHash(r.sha256)}</td>
          <td><button className="secondary" aria-label={`Open ${r.title || r.recordId}`} onClick={() => onOpen(r.recordId)}>Open</button></td></tr>)}</tbody>
      </table></div>}
  </>;
}

function AuditTable({ patientId }: { patientId: string }) {
  const { data, error } = useLoad<any[]>(() => api(`/patients/${patientId}/audit`), [patientId]);
  if (error) { return <div className="alert bad">{error}</div>; }
  if (!data) { return <p className="muted">Loading…</p>; }
  return <table>
    <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Facility</th><th>Record</th><th>Outcome</th><th>Reason</th><th>Tx</th></tr></thead>
    <tbody>{data.map(e => <tr key={e.txId}><td>{fmtDate(e.timestamp)}</td><td>{pretty(e.action)}</td><td>{e.actorId}</td><td>{ORG_LABEL[e.actorOrg]}</td>
      <td className="mono">{e.recordId ?? '—'}</td><td><Outcome o={e.outcome} /></td><td>{e.reason}</td><td className="mono">{shortHash(e.txId)}</td></tr>)}</tbody>
  </table>;
}

/* ======================= clinician ======================= */

function NewRecordForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [type, setType] = useState('DIAGNOSIS');
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    const lines = fields.split('\n').map(line => line.trim()).filter(Boolean);
    const malformed = lines.find(line => !line.includes(':') || !line.slice(0, line.indexOf(':')).trim() || !line.slice(line.indexOf(':') + 1).trim());
    if (malformed || !lines.length) {
      setMsg({ ok: false, text: malformed ? 'Use “field: value” for every finding.' : 'Add at least one clinical finding before saving.' });
      return;
    }
    const content = Object.fromEntries(lines.map(line => {
      const separator = line.indexOf(':');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ recordId: string; ledgerTxId: string }>('/records', { body: { patientId, recordType: type, title: title.trim(), content } });
      setMsg({ ok: true, text: `Saved ${r.recordId}. Hash anchored in tx ${shortHash(r.ledgerTxId)}` }); setTitle(''); onDone();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  };
  return <div className="card">
    <h2>Add clinical record</h2>
    <div className="grid2">
      <div><label>Record type</label><select aria-label="Record type" value={type} onChange={e => setType(e.target.value)}>{RECORD_TYPES.map(t => <option key={t} value={t}>{pretty(t)}</option>)}</select></div>
      <div><label>Title</label><input aria-label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Malaria RDT positive" /></div>
    </div>
    <label>Findings (one "field: value" per line)</label>
    <textarea aria-label="Findings, one field and value per line" value={fields} onChange={e => setFields(e.target.value)} />
    <div className="row action-row"><button disabled={title.trim().length < 3 || busy} onClick={submit}>{busy ? 'Encrypting and anchoring…' : 'Encrypt, store and anchor'}</button></div>
    {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
  </div>;
}

function EnrolPatient({ onDone }: { onDone: (id: string) => void }) {
  const [f, setF] = useState({ fullName: '', email: '', password: '', dateOfBirth: '', sex: 'Female', phone: '', state: 'Rivers', lga: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (busy) return;
    if (f.fullName.trim().length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) || f.password.length < 8 || !f.dateOfBirth) {
      setMsg({ ok: false, text: 'Enter a full name, valid email, password of at least 8 characters and date of birth.' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ patientId: string }>('/patients', { body: f });
      setMsg({ ok: true, text: `Patient ${r.patientId} enrolled and registered on the ledger.` });
      onDone(r.patientId);
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  };
  return <div className="card">
    <h2>Enrol a new patient</h2>
    <div className="grid2">
      <div><label>Full name</label><input aria-label="Full name" value={f.fullName} onChange={set('fullName')} /></div>
      <div><label>Email</label><input aria-label="Email" type="email" value={f.email} onChange={set('email')} /></div>
      <div><label>Temporary password</label><input aria-label="Temporary password" type="password" value={f.password} onChange={set('password')} /></div>
      <div><label>Date of birth</label><input aria-label="Date of birth" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></div>
      <div><label>Sex</label><select aria-label="Sex" value={f.sex} onChange={set('sex')}><option>Female</option><option>Male</option></select></div>
      <div><label>Phone</label><input aria-label="Phone" value={f.phone} onChange={set('phone')} /></div>
      <div><label>State</label><input aria-label="State" value={f.state} onChange={set('state')} /></div>
      <div><label>LGA</label><input aria-label="LGA" value={f.lga} onChange={set('lga')} /></div>
    </div>
    <div className="row action-row"><button disabled={busy} onClick={submit}>{busy ? 'Registering patient…' : 'Enrol and register on ledger'}</button></div>
    {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
  </div>;
}

function Clinician({ view }: { view: string }) {
  const { data: patients, error: patientsError, reload } = useLoad<any[]>(() => api('/patients'));
  const [sel, setSel] = useState<string>('');
  const [open, setOpen] = useState('');
  const [q, setQ] = useState('');
  const [k, setK] = useState(0);
  if (view === 'enrol') { return <EnrolPatient onDone={id => { reload(); setSel(id); }} />; }
  const list = (patients ?? []).filter(p => !q || `${p.fullName} ${p.patientId}`.toLowerCase().includes(q.toLowerCase()));
  const patient = (patients ?? []).find(p => p.patientId === sel);
  return <>
    <div className="card">
      <div className="row"><div><h2>Patients</h2><span className="muted">{patients?.length ?? 0} patient records</span></div><div className="spacer" />
        <input className="search-input" aria-label="Search patients by name or ID" placeholder="Search name or ID" value={q} onChange={e => setQ(e.target.value)} /></div>
      {patientsError ? <div className="alert bad" role="alert">{patientsError}</div> : !patients ? <p className="loading">Loading patient directory…</p> : !list.length ?
        <div className="empty-state"><b>{q ? 'No patients match your search' : 'No patients enrolled yet'}</b>{q ? 'Try a different name or patient ID.' : 'Enrol a patient to get started.'}</div> :
        <div className="table-wrap"><table><thead><tr><th>Patient</th><th>ID</th><th>Sex</th><th>Date of birth</th><th>Home facility</th><th>State / LGA</th><th></th></tr></thead>
          <tbody>{list.map(p => <tr key={p.patientId} className={sel === p.patientId ? 'clickable selected-row' : 'clickable'} onClick={() => { setSel(p.patientId); setOpen(''); }}>
            <td><b>{p.fullName}</b></td><td className="mono">{p.patientId}</td><td>{p.sex}</td><td>{p.dateOfBirth}</td><td>{ORG_LABEL[p.homeOrg] ?? p.homeOrg}</td><td>{[p.state, p.lga].filter(Boolean).join(' / ') || '—'}</td>
            <td><button className="secondary" aria-label={`Select patient ${p.fullName}`} onClick={() => { setSel(p.patientId); setOpen(''); }}>Select</button></td></tr>)}</tbody></table></div>}
    </div>
    {patient && <>
      <div className="card"><h2>{patient.fullName} <span className="badge brand">{ORG_LABEL[patient.homeOrg]}</span></h2>
        <p className="muted">Record list comes from a CouchDB rich query on the ledger. Opening a record is an audited, consent-checked transaction.</p>
        <RecordList key={`${patient.patientId}-${k}`} patientId={patient.patientId} onOpen={setOpen} /></div>
      {open && <RecordViewer recordId={open} onClose={() => setOpen('')} allowEmergency />}
      <NewRecordForm patientId={patient.patientId} onDone={() => setK(x => x + 1)} />
    </>}
  </>;
}

/* ======================= patient ======================= */

function PatientConsents({ me }: { me: string }) {
  const { data: consents, error: consentError, reload } = useLoad<any[]>(() => api(`/patients/${me}/consents`));
  const { data: docs, error: clinicianError } = useLoad<any[]>(() => api('/clinicians'));
  const [grantee, setGrantee] = useState('');
  const [scope, setScope] = useState('ALL');
  const [expiry, setExpiry] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const grant = async () => {
    if (!grantee || busy) return;
    setBusy('grant'); setMsg(null);
    try {
      const r = await api<{ ledgerTxId: string }>('/consents', { body: { granteeId: grantee, scope, expiresAt: expiry ? new Date(expiry).toISOString() : undefined } });
      setMsg({ ok: true, text: `Consent recorded on ledger (tx ${shortHash(r.ledgerTxId)})` });
      setGrantee(''); setExpiry(''); reload();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(''); }
  };
  const revoke = async (g: string) => {
    if (busy) return;
    setBusy(g); setMsg(null);
    try {
      const r = await api<{ ledgerTxId: string }>(`/consents/${encodeURIComponent(g)}`, { method: 'DELETE' });
      setMsg({ ok: true, text: `Consent revoked on ledger (tx ${shortHash(r.ledgerTxId)})` }); reload();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(''); }
  };
  return <>
    <div className="card">
      <h2>Give a clinician access to my records</h2>
      {clinicianError && <div className="alert bad" role="alert">Clinicians could not be loaded: {clinicianError}</div>}
      {consentError && <div className="alert bad" role="alert">Your current permissions could not be loaded: {consentError}</div>}
      <div className="grid2">
        <div><label>Clinician</label><select aria-label="Clinician" value={grantee} onChange={e => setGrantee(e.target.value)}><option value="">Choose…</option>
          {(docs ?? []).map(d => <option key={d.userId} value={d.userId}>{d.fullName} · {d.specialty} · {ORG_LABEL[d.org]}</option>)}</select></div>
        <div><label>What they can see</label><select aria-label="What they can see" value={scope} onChange={e => setScope(e.target.value)}><option value="ALL">All records</option>{RECORD_TYPES.map(t => <option key={t} value={t}>{pretty(t)} only</option>)}</select></div>
        <div><label>Access ends (optional)</label><input aria-label="Access ends (optional)" type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></div>
      </div>
      <div className="row action-row"><button disabled={!grantee || !docs || Boolean(busy)} onClick={grant}>{busy === 'grant' ? 'Recording consent…' : 'Grant access'}</button></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
    </div>
    <div className="card"><h2>Who can see my records</h2>
      <div className="table-wrap"><table><thead><tr><th>Clinician</th><th>Facility</th><th>Scope</th><th>Status</th><th>Granted</th><th>Ends</th><th></th></tr></thead>
        <tbody>{(consents ?? []).map(c => <tr key={c.granteeId}><td>{docs?.find(d => d.userId === c.granteeId)?.fullName ?? c.granteeId}<div className="mono muted">{c.granteeId}</div></td><td>{ORG_LABEL[c.granteeOrg] ?? c.granteeOrg}</td><td>{pretty(c.scope)}</td>
          <td><span className={`badge ${c.status === 'ACTIVE' ? 'ok' : 'bad'}`}>{c.status}</span></td><td>{fmtDate(c.grantedAt)}</td><td>{c.expiresAt ? fmtDate(c.expiresAt) : 'No end date'}</td>
          <td>{c.status === 'ACTIVE' && <button className="secondary" disabled={Boolean(busy)} onClick={() => revoke(c.granteeId)}>{busy === c.granteeId ? 'Revoking…' : 'Revoke'}</button>}</td></tr>)}</tbody></table></div>
      {!consentError && consents && !consents.length && <div className="empty-state"><b>No sharing permissions yet</b>When you grant access, your active and previous permissions will appear here.</div>}
    </div>
  </>;
}

function PatientView({ view, me }: { view: string; me: string }) {
  const [open, setOpen] = useState('');
  if (view === 'consent') { return <PatientConsents me={me} />; }
  if (view === 'audit') { return <div className="card"><h2>Who accessed my records</h2><p className="muted">Every access attempt, allowed or denied, is a transaction on the ledger and cannot be edited.</p><AuditTable patientId={me} /></div>; }
  return <><div className="card"><h2>My health records</h2><RecordList patientId={me} onOpen={setOpen} /></div>
    {open && <RecordViewer recordId={open} onClose={() => setOpen('')} />}</>;
}

/* ======================= auditor / admin ======================= */

function Auditor() {
  const { data: patients, error: patientsError } = useLoad<any[]>(() => api('/patients'));
  const [sel, setSel] = useState('');
  const [rid, setRid] = useState('');
  const [verify, setVerify] = useState<any>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [checking, setChecking] = useState(false);
  const check = async () => {
    const recordId = rid.trim();
    if (!recordId || checking) return;
    setChecking(true); setVerify(null); setHistory(null); setHistoryError('');
    try { setVerify(await api(`/records/${encodeURIComponent(recordId)}/verify`)); }
    catch (e: any) { setVerify({ error: e.message }); }
    try { setHistory(await api(`/records/${encodeURIComponent(recordId)}/history`)); }
    catch (e: any) { setHistoryError(e.message); }
    finally { setChecking(false); }
  };
  return <>
    <div className="card"><h2>Verify record integrity</h2>
      <p className="muted">Compare the encrypted record’s current hash with its ledger anchor and inspect the transaction history.</p>
      <form className="row" onSubmit={e => { e.preventDefault(); void check(); }}>
        <input className="flex-input" aria-label="Record ID to verify" placeholder="Record ID, e.g. REC-…" value={rid} onChange={e => setRid(e.target.value)} />
        <button disabled={!rid.trim() || checking}>{checking ? 'Checking…' : 'Verify against ledger'}</button>
      </form>
      {verify && (verify.error ? <div className="alert bad">{verify.error}</div> : verify.valid
        ? <div className="alert ok">Valid. Off-chain copy matches ledger hash {shortHash(verify.ledgerHash)} (version {verify.version}).</div>
        : <div className="alert bad">TAMPERED. Off-chain copy does not match ledger hash {shortHash(verify.ledgerHash)}.</div>)}
      {historyError && <div className="alert warn">Integrity was checked, but transaction history could not be loaded: {historyError}</div>}
      {history && <><h3>Ledger history of this record</h3><div className="table-wrap"><table><thead><tr><th>Time</th><th>Transaction</th><th>Version</th><th>Hash</th><th>Author</th></tr></thead>
        <tbody>{history.map((h: any) => <tr key={h.txId}><td>{fmtDate(h.timestamp)}</td><td className="mono">{shortHash(h.txId)}</td><td>{h.value?.version}</td><td className="mono">{shortHash(h.value?.sha256)}</td><td>{h.value?.authorId}</td></tr>)}</tbody></table></div></>}
    </div>
    <div className="card"><div className="row"><h2>Audit trail</h2><div className="spacer" />
      <select className="audit-patient-select" aria-label="Choose patient for audit trail" value={sel} onChange={e => setSel(e.target.value)}><option value="">Choose patient…</option>{(patients ?? []).map(p => <option key={p.patientId} value={p.patientId}>{p.fullName} ({p.patientId})</option>)}</select></div>
      {patientsError && <div className="alert bad" role="alert">Patient directory could not be loaded: {patientsError}</div>}
      {sel && <AuditTable patientId={sel} />}</div>
  </>;
}

function Admin() {
  const [f, setF] = useState({ fullName: '', email: '', password: '', role: 'clinician', specialty: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: staff, error, reload } = useLoad<any[]>(() => api('/staff'));
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ userId: string }>('/staff', { body: f });
      setMsg({ ok: true, text: `Created ${r.userId}` });
      setF({ fullName: '', email: '', password: '', role: 'clinician', specialty: '' });
      reload();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  };
  return <>
    <div className="card"><h2>Add staff account</h2>
      <div className="grid2">
        <div><label>Full name</label><input aria-label="Full name" minLength={3} value={f.fullName} onChange={set('fullName')} /></div>
        <div><label>Email</label><input aria-label="Email" type="email" value={f.email} onChange={set('email')} /></div>
        <div><label>Temporary password</label><input aria-label="Temporary password" type="password" minLength={8} value={f.password} onChange={set('password')} /></div>
        <div><label>Role</label><select aria-label="Role" value={f.role} onChange={set('role')}><option value="clinician">Clinician</option><option value="auditor">Auditor</option><option value="admin">Admin</option></select></div>
        <div><label>Specialty</label><input aria-label="Specialty" value={f.specialty} onChange={set('specialty')} /></div>
      </div>
      <div className="row action-row"><button disabled={busy || f.fullName.trim().length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) || f.password.length < 8} onClick={create}>{busy ? 'Creating account…' : 'Create account'}</button></div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}</div>
    <div className="card"><h2>Staff accounts</h2>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {!staff ? <p className="loading">Loading staff directory…</p> : !staff.length ? <div className="empty-state"><b>No staff accounts yet</b>Staff accounts created for this network will be listed here.</div> :
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>ID</th><th>Role</th><th>Specialty</th><th>Facility</th></tr></thead>
          <tbody>{staff.map(d => <tr key={d.userId}><td>{d.fullName}</td><td className="mono">{d.userId}</td><td><span className="badge brand">{pretty(d.role)}</span></td><td>{d.specialty || '—'}</td><td>{d.facility} <span className="muted">({d.org})</span></td></tr>)}</tbody></table></div>}
    </div>
  </>;
}

function Dashboard({ user, onNavigate }: { user: Session['user']; onNavigate: (view: string) => void }) {
  const { data, error } = useLoad<any>(async () => {
    if (user.role === 'patient') {
      const [recordPage, consents] = await Promise.all([
        api(`/patients/${user.userId}/records?pageSize=200`),
        api(`/patients/${user.userId}/consents`),
      ]);
      return { records: recordPage.records, hasMoreRecords: Boolean(recordPage.bookmark), consents };
    }
    if (user.role === 'admin') {
      const [patients, clinicians] = await Promise.all([api('/patients'), api('/clinicians')]);
      return { patients, clinicians };
    }
    return { patients: await api('/patients') };
  }, [user.role, user.userId]);

  const patient = user.role === 'patient';
  const metrics = patient
    ? [
      ['Health records', data ? `${data.records.length}${data.hasMoreRecords ? '+' : ''}` : '—', 'Your records available in the ledger'],
      ['Active permissions', data?.consents?.filter((c: any) => c.status === 'ACTIVE').length ?? '—', 'Clinicians with current access'],
      ['Account', 'Active', 'Your health information is protected'],
    ]
    : user.role === 'clinician'
      ? [['Patients', data?.patients?.length ?? '—', 'In your patient directory'], ['Workspace', 'Ready', user.org], ['Records', 'Secure', 'Audited and integrity-checked']]
      : user.role === 'admin'
        ? [['Patients', data?.patients?.length ?? '—', 'In the patient directory'], ['Clinicians', data?.clinicians?.length ?? '—', 'Staff accounts on the network'], ['Identity', 'Protected', 'Role-based access enabled']]
        : [['Patients', data?.patients?.length ?? '—', 'Available for audit'], ['Integrity', 'Verifiable', 'Ledger-backed record checks'], ['Audit trail', 'Immutable', 'Access decisions are recorded']];

  const actions: Record<string, [string, string, string][]> = {
    clinician: [['patients', 'Open patient directory', 'Search patients and review their consent-checked records.'], ['enrol', 'Enrol a patient', 'Create a patient account and register it on the ledger.']],
    patient: [['records', 'View my records', 'Review your clinical history and verified record details.'], ['consent', 'Manage sharing', 'Grant or revoke clinician access to your records.'], ['audit', 'Review access log', 'See recorded access attempts on your health data.']],
    admin: [['staff', 'Manage staff', 'Create and review staff identities for this facility.'], ['audit', 'Integrity and audit', 'Verify record hashes and inspect ledger history.']],
    auditor: [['audit', 'Open audit tools', 'Verify integrity and review patient access trails.']],
  };
  const greeting = user.fullName.split(' ')[0];
  return <>
    <div className="page-heading"><div><div className="eyebrow">Your workspace</div><h1>Welcome back, {greeting}</h1>
      <p>{user.role === 'patient' ? 'Your health information, permissions and access history in one secure place.' : 'A clear overview of your ChainCare workspace and the tools available to you.'}</p></div>
      <span className="badge brand">{pretty(user.role)} workspace</span></div>
    {error && <div className="alert bad" role="alert">{error}</div>}
    <div className="stats">{metrics.map(([label, value, note]) => <div className="stat" key={label}>
      <span className="stat-label">{label}</span><b>{data ? value : '…'}</b><span className="stat-note">{note}</span>
    </div>)}</div>
    <section className="card"><h2>Quick actions</h2><div className="quick-grid">{actions[user.role].map(([view, title, description]) =>
      <button className="quick-action" key={view} onClick={() => onNavigate(view)}><strong>{title}<br /><span>{description}</span></strong><span aria-hidden="true">→</span></button>)}</div></section>
    <div className="alert ok"><b>Privacy by design</b> · Sensitive clinical content is encrypted, and access decisions are checked against the permissioned ledger.</div>
  </>;
}

/* ======================= shell ======================= */

const NAV: Record<string, [string, string, string][]> = {
  clinician: [['home', 'Overview', '⌂'], ['patients', 'Patients & records', '▤'], ['enrol', 'Enrol patient', '+']],
  patient: [['home', 'Overview', '⌂'], ['records', 'My records', '▤'], ['consent', 'Consent & sharing', '◇'], ['audit', 'Access log', '◷']],
  auditor: [['home', 'Overview', '⌂'], ['audit', 'Integrity & audit', '✓']],
  admin: [['home', 'Overview', '⌂'], ['staff', 'Staff & identities', '♙'], ['audit', 'Integrity & audit', '✓']],
};

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try { onLogin(await api<Session>('/auth/login', { body: { email, password } })); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };
  return <div className="login-wrap">
    <aside className="login-aside">
      <div className="brand"><span className="brand-mark">+</span>ChainCare</div>
      <div className="login-copy"><div className="eyebrow login-eyebrow">Connected care, built on trust</div>
        <h1>Health records that move with you.</h1><p>Securely connect patients, clinicians and facilities with encrypted records and verifiable access.</p></div>
      <div className="login-note">Permissioned care network · Encrypted records · Audited access</div>
    </aside>
    <main className="login-panel"><form className="login" onSubmit={e => { e.preventDefault(); void go(); }}>
      <div className="brand"><span className="brand-mark">+</span>ChainCare EHR</div>
      <div className="eyebrow">Secure access</div><h1>Sign in</h1><p className="muted">Use your ChainCare account to continue to your secure workspace.</p>
      <label htmlFor="login-email">Email address</label><input id="login-email" aria-label="Email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
      <label htmlFor="login-password">Password</label><input id="login-password" aria-label="Password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
      {err && <div className="alert bad" role="alert">{err}</div>}
    </form></main>
  </div>;
}

function App() {
  const [s, setS] = useState<Session | null>(getSession());
  const [view, setView] = useState('');
  if (!s) { return <Login onLogin={x => { setSession(x); setS(x); setView('home'); }} />; }
  const nav = NAV[s.user.role];
  const v = nav.some(([key]) => key === view) ? view : nav[0][0];
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar"><div className="brand"><span className="brand-mark">+</span>ChainCare EHR</div>
      <div className="row"><div className="who"><b>{s.user.fullName}</b> · {pretty(s.user.role)}<br />{s.facility} · {s.user.org}</div>
        <button className="secondary" onClick={() => { setSession(null); setS(null); setView(''); }}>Sign out</button></div></header>
    <div className="shell">
      <nav className="nav" aria-label="Main navigation"><div className="nav-label">Workspace</div>{nav.map(([k, label, icon]) => <button key={k} className={v === k ? 'active' : ''} aria-current={v === k ? 'page' : undefined} onClick={() => setView(k)}><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</button>)}</nav>
      <main className="main" id="main">
        {v === 'home' && <Dashboard user={s.user} onNavigate={setView} />}
        {s.user.role === 'clinician' && v !== 'home' && <Clinician view={v} />}
        {s.user.role === 'patient' && v !== 'home' && <PatientView view={v} me={s.user.userId} />}
        {s.user.role === 'auditor' && v === 'audit' && <Auditor />}
        {s.user.role === 'admin' && v !== 'home' && (v === 'staff' ? <Admin /> : <Auditor />)}
      </main>
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
