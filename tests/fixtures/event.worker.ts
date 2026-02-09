import {
  DefineWorker,
  WorkerMethod,
  OnWorkerEvent,
  OnWorkerExit,
  OnWorkerError,
} from '../..';

@DefineWorker()
export class EventWorker {
  events: Array<{ event: string; args: unknown[] }> = [];

  @WorkerMethod()
  async throwError() {
    throw new Error('Test error');
  }

  @WorkerMethod()
  async exit() {
    process.exit(42);
  }

  @OnWorkerError()
  onError(error: Error) {
    this.events.push({ event: 'error', args: [error] });
  }

  @OnWorkerExit()
  onExit(code: number) {
    this.events.push({ event: 'exit', args: [code] });
  }

  @OnWorkerEvent('message')
  onMessage(...args: unknown[]) {
    this.events.push({ event: 'message', args });
  }

  @OnWorkerEvent('online')
  onOnline() {
    this.events.push({ event: 'online', args: [] });
  }
}
