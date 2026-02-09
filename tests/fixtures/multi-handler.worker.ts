import { DefineWorker, OnWorkerEvent } from '../..';

@DefineWorker()
export class MultiHandlerWorker {
  calls: string[] = [];

  @OnWorkerEvent('online')
  onOnline1() {
    this.calls.push('handler1');
  }

  @OnWorkerEvent('online')
  onOnline2() {
    this.calls.push('handler2');
  }
}
