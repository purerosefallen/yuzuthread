import { runInWorker } from '..';
import { CounterWorker } from './fixtures/counter.worker.js';

describe('runInWorker', () => {
  it('should run callback with a worker instance and auto finalize', async () => {
    const result = await runInWorker(CounterWorker, async (counter) => {
      const step1 = await counter.increment(2);
      const step2 = await counter.increment(3);

      return {
        step1,
        step2,
        localCount: counter.count,
      };
    });

    expect(result).toEqual({
      step1: { count: 2, isMainThread: false },
      step2: { count: 5, isMainThread: false },
      localCount: 0,
    });
  });

  it('should create a new worker for each call', async () => {
    const first = await runInWorker(CounterWorker, (counter) =>
      counter.increment(1),
    );
    const second = await runInWorker(CounterWorker, (counter) =>
      counter.increment(1),
    );

    expect(first).toEqual({ count: 1, isMainThread: false });
    expect(second).toEqual({ count: 1, isMainThread: false });
  });
});
