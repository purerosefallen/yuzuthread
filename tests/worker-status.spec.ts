import { initWorker, WorkerStatus } from '..';
import { ErrorWorker } from './fixtures/error.worker.js';
import { CounterWorker } from './fixtures/counter.worker.js';

describe('workerStatus', () => {
  it('should start with Ready status after initialization', async () => {
    const worker = await initWorker(CounterWorker);
    expect(worker.workerStatus()).toBe(WorkerStatus.Ready);
    await worker.finalize();
  });

  it('should remain Ready after successful method calls', async () => {
    const worker = await initWorker(CounterWorker);

    expect(worker.workerStatus()).toBe(WorkerStatus.Ready);
    await worker.increment(5);
    expect(worker.workerStatus()).toBe(WorkerStatus.Ready);
    await worker.add(1, 2);
    expect(worker.workerStatus()).toBe(WorkerStatus.Ready);

    await worker.finalize();
  });

  it('should remain Ready after method throws error', async () => {
    const worker = await initWorker(ErrorWorker);

    expect(worker.workerStatus()).toBe(WorkerStatus.Ready);

    await expect(worker.throwError()).rejects.toThrow('Worker method error');

    // Worker should still be Ready after a method error
    expect(worker.workerStatus()).toBe(WorkerStatus.Ready);

    // Should still be able to call other methods
    expect(await worker.normalMethod()).toBe('success');
    expect(worker.workerStatus()).toBe(WorkerStatus.Ready);

    await worker.finalize();
  });

  it('should transition to Finalized after finalize', async () => {
    const worker = await initWorker(CounterWorker);

    expect(worker.workerStatus()).toBe(WorkerStatus.Ready);

    await worker.finalize();

    expect(worker.workerStatus()).toBe(WorkerStatus.Finalized);
  });

  it('should stay Finalized after multiple finalize calls', async () => {
    const worker = await initWorker(CounterWorker);

    await worker.finalize();
    expect(worker.workerStatus()).toBe(WorkerStatus.Finalized);

    await worker.finalize();
    expect(worker.workerStatus()).toBe(WorkerStatus.Finalized);
  });
});
