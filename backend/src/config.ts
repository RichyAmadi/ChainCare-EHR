import crypto from 'crypto';
import path from 'path';

const TN = process.env.FABRIC_TEST_NETWORK ?? '/root/ehr/fabric-samples/test-network';
const orgPath = (org: string) => path.join(TN, 'organizations', 'peerOrganizations', `${org}.example.com`);

const isProduction = process.env.NODE_ENV === 'production';
const envJwtSecret = process.env.JWT_SECRET?.trim() || undefined;
const envDataKeyHex = process.env.DATA_KEY_HEX?.trim() || undefined;

function resolveJwtSecret(): string {
  if (envJwtSecret) return envJwtSecret;
  if (!isProduction) return 'change-me-in-production-0123456789abcdef';
  // No secret configured: a fresh random 256-bit key is still secure, but every
  // restart signs users out. Set JWT_SECRET to keep sessions across deploys.
  console.warn('[config] JWT_SECRET is not set; using a random key for this process. '
    + 'Users will be signed out on every restart. Set JWT_SECRET (64+ random characters) in your host settings.');
  return crypto.randomBytes(48).toString('hex');
}

const jwtSecret = resolveJwtSecret();
const dataKeyHex = envDataKeyHex ?? 'a3f1c2d4e5b6978877665544332211ffeeddccbbaa99887766554433221100aa';

if (isProduction) {
  const problems: string[] = [];
  if (envJwtSecret && (envJwtSecret.length < 32 || envJwtSecret.startsWith('change-me-in-production'))) {
    problems.push('JWT_SECRET must be a unique value of at least 32 characters (or remove it to use a random per-process key).');
  }
  if (!envDataKeyHex) {
    problems.push('DATA_KEY_HEX is not set. Generate one with `openssl rand -hex 32` and store a backup: losing it makes stored records unreadable.');
  } else if (!/^[\da-f]{64}$/i.test(envDataKeyHex)) {
    problems.push(`DATA_KEY_HEX must be exactly 64 hexadecimal characters (got ${envDataKeyHex.length}).`);
  }
  if (!process.env.MONGO_URI?.trim()) {
    problems.push('MONGO_URI is not set. Provide a persistent MongoDB connection string, e.g. from MongoDB Atlas.');
  }
  if (problems.length) {
    throw new Error(`Missing or invalid production configuration:\n  - ${problems.join('\n  - ')}\n`
      + 'Set these under Environment in your hosting dashboard (Render: Service > Environment), then redeploy.');
  }
}

export interface OrgConfig {
  mspId: string;
  facility: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  certDir: string;
  keyDir: string;
}

/** Each healthcare facility is a Fabric organisation with its own peer and identity. */
export const ORGS: Record<string, OrgConfig> = {
  Org1MSP: {
    mspId: 'Org1MSP',
    facility: 'Hospital A (tertiary teaching hospital)',
    peerEndpoint: process.env.FABRIC_ORG1_PEER_ENDPOINT ?? 'localhost:7051',
    peerHostAlias: process.env.FABRIC_ORG1_PEER_HOST_ALIAS ?? 'peer0.org1.example.com',
    tlsCertPath: process.env.FABRIC_ORG1_TLS_CERT_PATH ?? path.join(orgPath('org1'), 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt'),
    certDir: process.env.FABRIC_ORG1_IDENTITY_CERT_PATH ?? path.join(orgPath('org1'), 'users', 'User1@org1.example.com', 'msp', 'signcerts'),
    keyDir: process.env.FABRIC_ORG1_IDENTITY_KEY_PATH ?? path.join(orgPath('org1'), 'users', 'User1@org1.example.com', 'msp', 'keystore'),
  },
  Org2MSP: {
    mspId: 'Org2MSP',
    facility: 'Facility B (primary health centre)',
    peerEndpoint: process.env.FABRIC_ORG2_PEER_ENDPOINT ?? 'localhost:9051',
    peerHostAlias: process.env.FABRIC_ORG2_PEER_HOST_ALIAS ?? 'peer0.org2.example.com',
    tlsCertPath: process.env.FABRIC_ORG2_TLS_CERT_PATH ?? path.join(orgPath('org2'), 'peers', 'peer0.org2.example.com', 'tls', 'ca.crt'),
    certDir: process.env.FABRIC_ORG2_IDENTITY_CERT_PATH ?? path.join(orgPath('org2'), 'users', 'User1@org2.example.com', 'msp', 'signcerts'),
    keyDir: process.env.FABRIC_ORG2_IDENTITY_KEY_PATH ?? path.join(orgPath('org2'), 'users', 'User1@org2.example.com', 'msp', 'keystore'),
  },
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mode: (process.env.LEDGER_MODE ?? 'fabric') as 'fabric' | 'centralised',
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/ehr',
  jwtSecret,
  jwtTtl: '8h',
  // 32-byte key, hex. In production this comes from a key vault, never from source code.
  dataKeyHex,
  channel: process.env.FABRIC_CHANNEL ?? 'ehrchannel',
  chaincode: process.env.FABRIC_CHAINCODE ?? 'ehr',
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300),
};
