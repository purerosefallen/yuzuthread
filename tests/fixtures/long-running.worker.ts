import { DefineWorker, WorkerMethod, WorkerFinalize } from '../..';

@DefineWorker()
export class LongRunningWorker {
  @WorkerMethod()
  async longTask(duration: number) {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, duration));
    const end = Date.now();
    return { duration: end - start };
  }

  @WorkerMethod()
  async quickTask() {
    return 'quick result';
  }

  @WorkerFinalize()
  cleanup() {
    return 'cleanup done';
  }

  @WorkerMethod()
  async quickAndExit() {
    // Call the finalize method internally
    const result = this.cleanup();
    return result;
  }

  @WorkerMethod()
  @WorkerFinalize()
  async directExit(value: number) {
    return value * 10;
  }
}
