import 'dotenv/config';
import mongoose from 'mongoose';
import { buildApp } from './app';
import { config } from './config';
import { createLedger } from './ledger';
import { connectDatabase } from './mongo';

async function main() {
  await connectDatabase(config.mongoUri);
  const ledger = await createLedger();
  const app = buildApp(ledger);
  const server = app.listen(config.port, () =>
    console.log(`EHR API listening on :${config.port} (ledger=${config.mode}, database connected)`));
  const shutdown = async () => { server.close(); await ledger.close(); await mongoose.disconnect(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => { console.error(err); process.exit(1); });
