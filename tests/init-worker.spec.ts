import { initWorker } from '../src/init-worker';
import { CounterWorker } from './fixtures/counter.worker.js';
import { SharedStructWorker } from './fixtures/shared-struct.worker.js';

describe('initWorker', () => {

  it('should execute @WorkerMethod in worker thread', async () => {
    const counter = await initWorker(CounterWorker);
    const result = await counter.increment(2);

    expect(result).toEqual({ count: 2, isMainThread: false });
    expect(counter.count).toBe(0);
    await counter.finalize();
  });

  it('should sync typed-struct data through shared memory', async () => {
    const counter = await initWorker(SharedStructWorker, [0x10]);
    expect(counter.value).toBe(0x10);
    expect(await counter.setValue(0x7f)).toBe(0x7f);
    expect(counter.value).toBe(0x7f);
    await counter.finalize();
  });

  it('should reject worker calls after finalize', async () => {
    const counter = await initWorker(CounterWorker);
    await counter.finalize();
    await expect(counter.add(1, 2)).rejects.toThrow('Worker has been finalized');
  });
});
