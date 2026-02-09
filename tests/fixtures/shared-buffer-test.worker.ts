import { Struct } from 'typed-struct';
import {
  WorkerMethod,
  DefineWorker,
  TransportType,
  TransportEncoder,
} from '../..';

const Base = new Struct('SharedBufferTestBase')
  .UInt8('counter')
  .UInt32LE('timestamp')
  .compile();

class SharedData extends Base {
  declare counter: number;
  declare timestamp: number;
}

// Typed-struct class with additional transport fields
class ComplexSharedData extends Base {
  declare counter: number;
  declare timestamp: number;

  @TransportType(() => SharedData)
  nested?: SharedData;

  @TransportEncoder(
    (date: Date) => date.toISOString(),
    (str: string) => new Date(str),
  )
  createdAt?: Date;

  metadata: string = '';
}

// Regular class containing shared typed-struct field
class DataContainer {
  @TransportType(() => SharedData)
  sharedData!: SharedData;

  label: string = '';

  constructor(sharedData?: SharedData, label?: string) {
    if (sharedData) this.sharedData = sharedData;
    if (label) this.label = label;
  }
}

@DefineWorker()
export class SharedBufferTestWorker {
  @WorkerMethod()
  readValue(@TransportType(() => SharedData) data: SharedData): {
    counter: number;
    timestamp: number;
  } {
    // Worker 读取值
    return {
      counter: data.counter,
      timestamp: data.timestamp,
    };
  }

  @WorkerMethod()
  modifyValue(@TransportType(() => SharedData) data: SharedData): void {
    // Worker 修改值
    data.counter += 10;
    data.timestamp = Date.now();
  }

  @WorkerMethod()
  incrementCounter(@TransportType(() => SharedData) data: SharedData): number {
    // Worker 递增计数器并返回新值
    data.counter++;
    return data.counter;
  }

  @WorkerMethod()
  async waitAndModify(
    @TransportType(() => SharedData) data: SharedData,
    delayMs: number,
  ): Promise<void> {
    // 等待一段时间后修改值
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    data.counter = 99;
    data.timestamp = 12345678;
  }

  @WorkerMethod()
  @TransportType(() => ComplexSharedData)
  createComplexShared(): ComplexSharedData {
    // Create nested shared data
    const nestedShared = new SharedArrayBuffer(Base.baseSize);
    const nestedBuffer = Buffer.from(nestedShared);
    const nested = new SharedData(nestedBuffer, false);
    nested.counter = 10;
    nested.timestamp = 2000;

    // Create main shared data
    const mainShared = new SharedArrayBuffer(Base.baseSize);
    const mainBuffer = Buffer.from(mainShared);
    const main = new ComplexSharedData(mainBuffer, false);
    main.counter = 5;
    main.timestamp = 1000;
    main.nested = nested;
    main.createdAt = new Date('2024-01-01');
    main.metadata = 'test';

    return main;
  }

  @WorkerMethod()
  modifyComplexShared(
    @TransportType(() => ComplexSharedData) data: ComplexSharedData,
  ): void {
    // Modify main struct
    data.counter += 1;
    data.timestamp += 100;

    // Modify nested struct
    if (data.nested) {
      data.nested.counter += 1;
      data.nested.timestamp += 100;
    }

    // Modify regular fields
    data.metadata += ' modified';
  }

  @WorkerMethod()
  @TransportType(() => DataContainer)
  createContainer(): DataContainer {
    const sharedMemory = new SharedArrayBuffer(Base.baseSize);
    const sharedBuffer = Buffer.from(sharedMemory);
    const sharedData = new SharedData(sharedBuffer, false);
    sharedData.counter = 20;
    sharedData.timestamp = 3000;

    return new DataContainer(sharedData, 'container');
  }

  @WorkerMethod()
  modifyContainer(
    @TransportType(() => DataContainer) container: DataContainer,
  ): void {
    container.sharedData.counter += 5;
    container.sharedData.timestamp += 500;
    container.label += ' modified';
  }

  @WorkerMethod()
  readContainerValues(
    @TransportType(() => DataContainer) container: DataContainer,
  ): { counter: number; timestamp: number; label: string } {
    return {
      counter: container.sharedData.counter,
      timestamp: container.sharedData.timestamp,
      label: container.label,
    };
  }
}
