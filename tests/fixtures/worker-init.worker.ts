import { DefineWorker, WorkerInit, WorkerMethod } from '../..';

@DefineWorker()
export class WorkerInitTestWorker {
  initialized = false;
  initValue = 0;

  @WorkerInit()
  async initialize() {
    this.initialized = true;
    this.initValue = 42;
  }

  @WorkerMethod()
  async getStatus() {
    return {
      initialized: this.initialized,
      initValue: this.initValue,
    };
  }
}

@DefineWorker()
export class WorkerInitFailWorker {
  @WorkerInit()
  async initialize() {
    throw new Error('Initialization failed');
  }

  @WorkerMethod()
  async dummy() {
    return 'should not be called';
  }
}

@DefineWorker()
export class MultipleInitWorker {
  init1Done = false;
  init2Done = false;

  @WorkerInit()
  async init1() {
    this.init1Done = true;
  }

  @WorkerInit()
  async init2() {
    this.init2Done = true;
  }

  @WorkerMethod()
  async getInitStatus() {
    return {
      init1Done: this.init1Done,
      init2Done: this.init2Done,
    };
  }
}
