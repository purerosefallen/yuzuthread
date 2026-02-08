import { isMainThread } from 'node:worker_threads';
import { WorkerMethod } from '../../src/worker-method';
import { Worker } from '../../src/worker';

@Worker(__filename)
export class CounterWorker {
  count = 0;

  @WorkerMethod()
  async increment(step: number) {
    this.count += step;
    return {
      count: this.count,
      isMainThread,
    };
  }

  @WorkerMethod()
  add(a: number, b: number) {
    return a + b;
  }
}
