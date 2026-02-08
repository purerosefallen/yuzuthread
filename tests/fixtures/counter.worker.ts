import { isMainThread } from 'node:worker_threads';
import { WorkerCallback, WorkerMethod, DefineWorker } from '../..';

@DefineWorker()
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

  @WorkerCallback()
  onMainAdd(a: number, b: number) {
    this.count += a + b;
    return {
      count: this.count,
      isMainThread,
    };
  }

  @WorkerMethod()
  async callMainAdd(a: number, b: number) {
    return this.onMainAdd(a, b);
  }
}
