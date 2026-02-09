import { DefineWorker, OnWorkerEvent } from '../..';

@DefineWorker()
export class ErrorHandlerWorker {
  errorCount = 0;

  @OnWorkerEvent('online')
  onOnlineError() {
    this.errorCount++;
    throw new Error('Handler error');
  }

  @OnWorkerEvent('online')
  onOnlineOk() {
    this.errorCount++;
  }
}
