import { writeSync } from 'node:fs';
import { initWorker } from '../../../dist/index.mjs';
import { TopLevelAwaitWorker } from './top-level-await.worker.mjs';

const main = async () => {
  const worker = await initWorker(TopLevelAwaitWorker);
  const result = await worker.add(3, 4);
  writeSync(1, `${JSON.stringify(result)}\n`);
  await worker.finalize();
};

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
