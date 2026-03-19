import { DefineWorker, WorkerMethod } from '../../../dist/index.mjs';

await Promise.resolve();

class TopLevelAwaitWorker {
  add(a, b) {
    return {
      sum: a + b,
      hasExpectedWorkerUrl: import.meta.url.endsWith(
        '/top-level-await.worker.mjs',
      ),
    };
  }
}

WorkerMethod()(TopLevelAwaitWorker.prototype, 'add');
DefineWorker({ moduleUrl: import.meta.url })(TopLevelAwaitWorker);

export { TopLevelAwaitWorker };
