import { writeSync } from 'node:fs';
import { initWorker, WorkerStatus } from '../../../dist/index.mjs';
import { BasicEsmWorker } from './basic.worker.mjs';

const main = async () => {
  const worker = await initWorker(BasicEsmWorker);
  const remote = await worker.increment(2);
  const callback = await worker.callMainAdd(3, 4);
  const local = worker.onMainAdd(1, 2);
  const readyStatus = worker.workerStatus() === WorkerStatus.Ready;
  await worker.finalize();
  const finalizedStatus = worker.workerStatus() === WorkerStatus.Finalized;

  writeSync(
    1,
    `${JSON.stringify({
      remote,
      callback,
      local,
      mainCount: worker.count,
      readyStatus,
      finalizedStatus,
    })}\n`,
  );
};

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
