import crypto from 'crypto';
import { config } from './config';

const key = Buffer.from(config.dataKeyHex, 'hex');

export interface Sealed { iv: string; tag: string; ciphertext: string; }

/** AES-256-GCM encryption of a clinical payload before it is stored off-chain. */
export function encrypt(plain: Buffer): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decrypt(s: Sealed): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(s.ciphertext, 'base64')), decipher.final()]);
}

/** SHA-256 over the sealed (encrypted) form: this is the value anchored on the ledger. */
export function sealedHash(s: Sealed): string {
  return crypto.createHash('sha256').update(`${s.iv}.${s.tag}.${s.ciphertext}`).digest('hex');
}
