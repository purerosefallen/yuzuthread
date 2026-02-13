import {
  DefineWorker,
  WorkerFinalize,
  WorkerMethod,
  OnWorkerExit,
} from '../..';

@DefineWorker()
export class WorkerFinalizeTestWorker {
  exitCalled = false;

  @OnWorkerExit()
  onExit() {
    this.exitCalled = true;
  }

  @WorkerFinalize()
  finalizeMethod(value: number) {
    return value * 2;
  }

  @WorkerMethod()
  async computeAndExit(value: number) {
    // Call the @WorkerFinalize method from within @WorkerMethod
    return this.finalizeMethod(value);
  }

  @WorkerMethod()
  async regularMethod(value: number) {
    return value + 10;
  }
}

@DefineWorker()
export class WorkerFinalizeErrorWorker {
  @WorkerFinalize()
  finalizeWithError() {
    throw new Error('Method failed');
  }

  @WorkerMethod()
  async failAndExit() {
    // Call the @WorkerFinalize method that throws
    return this.finalizeWithError();
  }

  @WorkerMethod()
  async shouldNotBeCalled() {
    return 'should not reach here';
  }
}

@DefineWorker()
export class WorkerFinalizeDirectWorker {
  @WorkerMethod()
  @WorkerFinalize()
  async directFinalizeMethod(value: number) {
    // Method that is both @WorkerMethod and @WorkerFinalize
    return value * 3;
  }

  @WorkerMethod()
  async normalMethod(value: number) {
    return value + 5;
  }
}
