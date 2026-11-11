import mongoose, { Schema } from 'mongoose';

export type Role = 'patient' | 'clinician' | 'admin' | 'auditor';

const UserSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['patient', 'clinician', 'admin', 'auditor'], required: true },
  org: { type: String, enum: ['Org1MSP', 'Org2MSP'], required: true },
  specialty: String,
}, { timestamps: true });

const PatientSchema = new Schema({
  patientId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true },
  fullName: String,
  dateOfBirth: String,
  sex: String,
  phone: String,
  state: String,
  lga: String,
  homeOrg: String,
}, { timestamps: true });

/** Off-chain clinical record: encrypted payload + the hash anchored on the ledger. */
const RecordSchema = new Schema({
  recordId: { type: String, required: true, unique: true, index: true },
  patientId: { type: String, required: true, index: true },
  recordType: { type: String, required: true },
  title: String,
  sealed: { iv: String, tag: String, ciphertext: String },
  sha256: { type: String, required: true },
  ledgerTxId: String,
  authorId: String,
  authorOrg: String,
  sizeBytes: Number,
}, { timestamps: true });

/** Used only by the centralised baseline, where consent and audit live in MongoDB. */
const ConsentSchema = new Schema({
  patientId: { type: String, index: true },
  granteeId: String, granteeOrg: String, scope: String,
  status: String, expiresAt: String, grantedAt: String, revokedAt: String,
});
ConsentSchema.index({ patientId: 1, granteeId: 1 }, { unique: true });

const AuditSchema = new Schema({
  txId: String, action: String, actorId: String, actorOrg: String,
  patientId: { type: String, index: true }, recordId: String,
  outcome: String, reason: String, timestamp: String,
});

const AnchorSchema = new Schema({
  recordId: { type: String, unique: true }, patientId: String, recordType: String,
  sha256: String, offChainRef: String, authorId: String, authorOrg: String,
  version: Number, createdAt: String, updatedAt: String,
});
const PatientAnchorSchema = new Schema({ patientId: { type: String, unique: true }, homeOrg: String, createdAt: String });

export const User = mongoose.model('User', UserSchema);
export const Patient = mongoose.model('Patient', PatientSchema);
export const MedicalRecord = mongoose.model('MedicalRecord', RecordSchema);
export const CConsent = mongoose.model('CentralConsent', ConsentSchema);
export const CAudit = mongoose.model('CentralAudit', AuditSchema);
export const CAnchor = mongoose.model('CentralAnchor', AnchorSchema);
export const CPatient = mongoose.model('CentralPatient', PatientAnchorSchema);
