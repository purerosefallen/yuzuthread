import { initWorker } from '..';
import {
  WorkerInitTestWorker,
  WorkerInitFailWorker,
  MultipleInitWorker,
} from './fixtures/worker-init.worker.js';

describe('@WorkerInit', () => {
  it('should run @WorkerInit method before worker is ready', async () => {
    const worker = await initWorker(WorkerInitTestWorker);

    const status = await worker.getStatus();
    expect(status.initialized).toBe(true);
    expect(status.initValue).toBe(42);

    await worker.finalize();
  });

  it('should fail initWorker if @WorkerInit throws error', async () => {
    await expect(initWorker(WorkerInitFailWorker)).rejects.toThrow(
      'Initialization failed',
    );
  });

  it('should run all @WorkerInit methods in order', async () => {
    const worker = await initWorker(MultipleInitWorker);

    const status = await worker.getInitStatus();
    expect(status.init1Done).toBe(true);
    expect(status.init2Done).toBe(true);

    await worker.finalize();
  });
});
