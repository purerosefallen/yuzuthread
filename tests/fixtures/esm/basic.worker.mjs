import { isMainThread } from 'node:worker_threads';
import {
  DefineWorker,
  WorkerCallback,
  WorkerMethod,
} from '../../../dist/index.mjs';

class BasicEsmWorker {
  count = 0;

  increment(step) {
    this.count += step;
    return {
      count: this.count,
      isMainThread,
      hasExpectedWorkerUrl: import.meta.url.endsWith('/basic.worker.mjs'),
    };
  }

  onMainAdd(a, b) {
    this.count += a + b;
    return {
      count: this.count,
      isMainThread,
    };
  }

  async callMainAdd(a, b) {
    return this.onMainAdd(a, b);
  }
}

WorkerMethod()(BasicEsmWorker.prototype, 'increment');
WorkerCallback()(BasicEsmWorker.prototype, 'onMainAdd');
WorkerMethod()(BasicEsmWorker.prototype, 'callMainAdd');
DefineWorker({ moduleUrl: import.meta.url })(BasicEsmWorker);

export { BasicEsmWorker };
