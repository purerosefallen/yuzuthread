import { initWorker } from '..';
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

  it('should execute @WorkerCallback on main thread when invoked from worker', async () => {
    const counter = await initWorker(CounterWorker);
    const result = await counter.callMainAdd(2, 3);

    expect(result).toEqual({ count: 5, isMainThread: true });
    expect(counter.count).toBe(5);
    await counter.finalize();
  });

  it('should keep @WorkerCallback as local method in main thread', async () => {
    const counter = await initWorker(CounterWorker);

    const local = counter.onMainAdd(4, 5);
    expect(local).toEqual({ count: 9, isMainThread: true });
    expect(counter.count).toBe(9);

    const remote = await counter.increment(1);
    expect(remote).toEqual({ count: 1, isMainThread: false });
    expect(counter.count).toBe(9);
    await counter.finalize();
  });
});
