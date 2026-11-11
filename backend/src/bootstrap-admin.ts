import 'dotenv/config';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { config } from './config';
import { connectDatabase } from './mongo';
import { User } from './models';

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(14),
  fullName: z.string().min(3),
  org: z.enum(['Org1MSP', 'Org2MSP']),
});

async function main() {
  const account = bootstrapSchema.parse({
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    fullName: process.env.BOOTSTRAP_ADMIN_NAME,
    org: process.env.BOOTSTRAP_ADMIN_ORG,
  });

  await connectDatabase(config.mongoUri);
  if (await User.exists({ role: 'admin' })) {
    throw new Error('An administrator already exists; refusing to create another bootstrap account');
  }

  const userId = `ADM-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  await User.create({
    userId,
    fullName: account.fullName,
    email: account.email,
    role: 'admin',
    org: account.org,
    passwordHash: await bcrypt.hash(account.password, 12),
  });
  console.log(`Created initial administrator ${userId} for ${account.org}`);
}

main()
  .catch(error => {
    console.error('Administrator bootstrap failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => { await mongoose.disconnect(); });
