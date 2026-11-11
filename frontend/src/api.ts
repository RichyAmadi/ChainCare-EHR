export interface SessionUser { userId: string; role: 'patient' | 'clinician' | 'admin' | 'auditor'; org: string; fullName: string; }
export interface Session { token: string; user: SessionUser; facility: string; }

let session: Session | null = null;
export const setSession = (s: Session | null) => { session = s; };
export const getSession = () => session;

export class ApiError extends Error { constructor(public status: number, message: string, public body: any) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { throw new ApiError(res.status, body.error ?? res.statusText, body); }
  return body as T;
}

export const RECORD_TYPES = ['DIAGNOSIS', 'LAB_RESULT', 'PRESCRIPTION', 'IMAGING', 'VACCINATION', 'ALLERGY', 'DISCHARGE_SUMMARY', 'REFERRAL'];
export const ORG_LABEL: Record<string, string> = { Org1MSP: 'Hospital A', Org2MSP: 'Facility B (PHC)' };
export const pretty = (t: string) => t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
export const shortHash = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '');
export const fmtDate = (d?: string) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
