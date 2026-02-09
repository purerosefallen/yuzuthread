import { Struct } from 'typed-struct';
import { DefineWorker, WorkerMethod, Shared, TransportType } from '../..';

// Define shared data structures
const Base = new Struct('SharedParamBase')
  .UInt32LE('counter')
  .UInt8('flag')
  .compile();

export class SharedData extends Base {
  declare counter: number;
  declare flag: number;
}

export class SimpleContainer {
  buffer: Buffer;

  constructor(size: number) {
    this.buffer = Buffer.alloc(size);
  }
}

// Worker with single @Shared parameter (not a typed-struct itself)
@DefineWorker()
export class SingleSharedWorker {
  private data: SharedData;

  constructor(@Shared(() => SharedData) data: SharedData) {
    this.data = data;
  }

  @WorkerMethod()
  incrementCounter(): number {
    this.data.counter++;
    return this.data.counter;
  }

  @WorkerMethod()
  setFlag(value: number): void {
    this.data.flag = value;
  }

  @WorkerMethod()
  getValues(): { counter: number; flag: number } {
    return { counter: this.data.counter, flag: this.data.flag };
  }
}

// Worker with multiple @Shared parameters
@DefineWorker()
export class MultiSharedWorker {
  private data1: SharedData;
  private data2: SharedData;

  constructor(
    @Shared(() => SharedData) data1: SharedData,
    @Shared(() => SharedData) data2: SharedData,
  ) {
    this.data1 = data1;
    this.data2 = data2;
  }

  @WorkerMethod()
  incrementBoth(): { counter1: number; counter2: number } {
    this.data1.counter++;
    this.data2.counter++;
    return { counter1: this.data1.counter, counter2: this.data2.counter };
  }
}

// typed-struct worker with @Shared parameters
const WorkerBase = new Struct('SharedWorkerBase')
  .UInt8('value')
  .compile();

@DefineWorker()
export class MixedSharedWorker extends WorkerBase {
  declare value: number;
  private data: SharedData;

  constructor(
    initial: number,
    @Shared(() => SharedData) data: SharedData,
  ) {
    super([initial]);
    this.data = data;
  }

  @WorkerMethod()
  incrementValue(): number {
    this.value++;
    return this.value;
  }

  @WorkerMethod()
  incrementDataCounter(): number {
    this.data.counter++;
    return this.data.counter;
  }

  @WorkerMethod()
  getAll(): { value: number; counter: number; flag: number } {
    return {
      value: this.value,
      counter: this.data.counter,
      flag: this.data.flag,
    };
  }
}
