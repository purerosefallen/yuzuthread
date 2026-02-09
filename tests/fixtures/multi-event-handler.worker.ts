import { DefineWorker, OnWorkerEvent } from '../..';

@DefineWorker()
export class MultiEventHandlerWorker {
  events: string[] = [];

  @OnWorkerEvent('online')
  @OnWorkerEvent('exit')
  onMultipleEvents(arg?: unknown) {
    this.events.push('multi-handler');
  }

  @OnWorkerEvent('online')
  onOnlineOnly() {
    this.events.push('online-only');
  }
}
