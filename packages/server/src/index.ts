// packages/server/src/index.ts

import { loadConfig } from './config.js';
import { createApp } from './app.js';

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith('--mode='));
const mode = modeArg?.split('=')[1] ?? 'server';

const config = loadConfig();

if (mode === 'server') {
  const app = await createApp(config);
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`Server listening on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
} else if (mode === 'worker') {
  // Placeholder for Phase 4B worker
  console.log('Worker mode: not yet implemented');
  process.exit(0);
} else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}
