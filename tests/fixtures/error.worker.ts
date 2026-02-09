import { DefineWorker, WorkerMethod } from '../..';

@DefineWorker()
export class ErrorWorker {
  @WorkerMethod()
  async throwError() {
    throw new Error('Worker method error');
  }

  @WorkerMethod()
  async normalMethod() {
    return 'success';
  }
}
