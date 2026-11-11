import path from 'path';

const TN = process.env.FABRIC_TEST_NETWORK ?? '/root/ehr/fabric-samples/test-network';
const orgPath = (org: string) => path.join(TN, 'organizations', 'peerOrganizations', `${org}.example.com`);

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET ?? 'change-me-in-production-0123456789abcdef';
const dataKeyHex = process.env.DATA_KEY_HEX ?? 'a3f1c2d4e5b6978877665544332211ffeeddccbbaa99887766554433221100aa';

if (isProduction && (!process.env.JWT_SECRET || jwtSecret.length < 32 || jwtSecret.startsWith('change-me-in-production'))) {
  throw new Error('Production requires a unique JWT_SECRET of at least 32 characters');
}
if (isProduction && (!process.env.DATA_KEY_HEX || !/^[\da-f]{64}$/i.test(dataKeyHex))) {
  throw new Error('Production requires DATA_KEY_HEX to be exactly 64 hexadecimal characters');
}
if (isProduction && !process.env.MONGO_URI) {
  throw new Error('Production requires an explicit persistent MONGO_URI');
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
