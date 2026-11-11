import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memoryServer: MongoMemoryServer | null = null;

function shouldUseMemoryFallback(uri: string) {
  if (!/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(uri)) {
    return false;
  }
  return process.env.NODE_ENV !== 'production';
}

export async function connectDatabase(uri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/ehr') {
  try {
    await mongoose.connect(uri);
    return { mongoUri: uri, stop: async () => {} };
  } catch (err) {
    if (!shouldUseMemoryFallback(uri)) {
      throw err;
    }

    if (!memoryServer) {
      memoryServer = await MongoMemoryServer.create({
        binary: { version: '7.0.14' },
        instance: { dbName: 'ehr' },
      });
    }

    const resolvedUri = memoryServer.getUri();
    await mongoose.connect(resolvedUri);
    process.env.MONGO_URI = resolvedUri;
    return {
      mongoUri: resolvedUri,
      stop: async () => {
        if (!memoryServer) { return; }
        await memoryServer.stop();
        memoryServer = null;
      },
    };
  }
}
