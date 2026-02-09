import { Struct } from 'typed-struct';
import { DefineWorker, WorkerMethod, TransportType } from '../..';

const ManualSharedDataBase = new Struct('ManualSharedData')
  .UInt32LE('counter')
  .UInt32LE('value')
  .compile();

export class ManualSharedData extends ManualSharedDataBase {
  declare counter: number;
  declare value: number;
}

@DefineWorker()
export class ManualSharedWorker {
  constructor(public data: ManualSharedData) {}

  @WorkerMethod()
  incrementCounter() {
    this.data.counter++;
    return this.data.counter;
  }

  @WorkerMethod()
  setValue(value: number) {
    this.data.value = value;
  }

  @WorkerMethod()
  getValues() {
    return {
      counter: this.data.counter,
      value: this.data.value,
    };
  }
}
