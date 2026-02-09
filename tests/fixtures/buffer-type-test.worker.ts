import { Struct } from 'typed-struct';
import { WorkerMethod, DefineWorker, TransportType } from '../..';

const Base = new Struct('BufferSharedBase')
  .UInt8('value')
  .UInt32LE('count')
  .compile();

const NestedStructBase = new Struct('NestedStructBase')
  .UInt32LE('counter')
  .UInt32LE('flags')
  .compile();

// Nested typed-struct class
class NestedData extends NestedStructBase {
  declare counter: number;
  declare flags: number;
}

// Test class with custom constructor - first param is NOT a buffer
// This represents a common pattern: user adds custom fields/logic to constructor
// The challenge for decoder: it can't call `new CustomConstructorData(buffer, false)`
// because userName would receive the Buffer object!
class CustomConstructorData extends Base {
  declare value: number;
  declare count: number;

  customField: string = '';
  userName: string = '';

  constructor(userName: string = '', initBuffer?: Buffer, clone?: boolean) {
    // First parameter is custom! NOT the standard (raw?, clone?) signature
    // Decoder will call: new CustomConstructorData()
    // with mutateTypedStructProto intercepting super() to provide the buffer
    super(initBuffer as any, clone as any);
    this.userName = userName;
    this.customField = 'initialized';
  }
}

// Complex class with custom constructor AND transport-decorated fields
class ComplexCustomData extends Base {
  declare value: number;
  declare count: number;

  customField: string = '';
  label: string = '';

  // Field with @TransportType containing nested typed-struct
  @TransportType(() => NestedData)
  nestedData?: NestedData;

  // Field with SharedArrayBuffer
  sharedBuffer?: SharedArrayBuffer;

  // Field with Buffer (can be backed by SharedArrayBuffer)
  dataBuffer?: Buffer;

  // Field with Date (needs transport)
  @TransportType(() => Date)
  timestamp?: Date;

  constructor(label: string = '', initBuffer?: Buffer, clone?: boolean) {
    super(initBuffer as any, clone as any);
    this.label = label;
    this.customField = 'complex';
  }
}

// Regular class (not typed-struct) with Buffer and SharedArrayBuffer fields
class DataContainer {
  label: string = '';

  // Buffer field - can be SharedArrayBuffer-backed
  buffer?: Buffer;

  // SharedArrayBuffer field
  shared?: SharedArrayBuffer;

  // Nested typed-struct
  @TransportType(() => NestedData)
  nestedStruct?: NestedData;

  constructor(label: string = '') {
    this.label = label;
  }
}

@DefineWorker()
export class BufferTypeTestWorker {
  @WorkerMethod()
  modifyBuffer(buffer: Buffer): void {
    // Modify the buffer
    buffer.writeUInt8(99, 0);
    if (buffer.length >= 5) {
      buffer.writeUInt32LE(12345, 1);
    }
  }

  @WorkerMethod()
  readBuffer(buffer: Buffer): { value: number; count?: number } {
    const value = buffer.readUInt8(0);
    const count = buffer.length >= 5 ? buffer.readUInt32LE(1) : undefined;
    return { value, count };
  }

  @WorkerMethod()
  modifySharedArrayBuffer(sab: SharedArrayBuffer): void {
    const view = new Uint8Array(sab);
    view[0] = 88;
    if (view.length >= 5) {
      const dv = new DataView(sab);
      dv.setUint32(1, 54321, true); // little endian
    }
  }

  @WorkerMethod()
  readSharedArrayBuffer(sab: SharedArrayBuffer): {
    value: number;
    count?: number;
  } {
    const view = new Uint8Array(sab);
    const value = view[0];
    let count: number | undefined;
    if (view.length >= 5) {
      const dv = new DataView(sab);
      count = dv.getUint32(1, true); // little endian
    }
    return { value, count };
  }

  @WorkerMethod()
  @TransportType(() => CustomConstructorData)
  createCustomData(): CustomConstructorData {
    const sharedMemory = new SharedArrayBuffer(Base.baseSize);
    const buffer = Buffer.from(sharedMemory);

    // Create instance - note the first parameter is userName (custom), NOT buffer!
    const data = new CustomConstructorData('worker-user', buffer, false);
    data.value = 77;
    data.count = 7777;
    return data;
  }

  @WorkerMethod()
  modifyCustomData(
    @TransportType(() => CustomConstructorData) data: CustomConstructorData,
  ): void {
    data.value += 1;
    data.count += 1;
    data.customField += ' modified';
  }

  @WorkerMethod()
  @TransportType(() => ComplexCustomData)
  createComplexCustomData(): ComplexCustomData {
    // Create main struct with SharedArrayBuffer
    const mainShared = new SharedArrayBuffer(Base.baseSize);
    const mainBuffer = Buffer.from(mainShared);
    const data = new ComplexCustomData('worker-complex', mainBuffer, false);
    data.value = 100;
    data.count = 200;

    // Create nested typed-struct with SharedArrayBuffer
    const nestedShared = new SharedArrayBuffer(NestedStructBase.baseSize);
    const nestedBuffer = Buffer.from(nestedShared);
    data.nestedData = new NestedData(nestedBuffer, false);
    data.nestedData.counter = 50;
    data.nestedData.flags = 0xff;

    // Create a separate SharedArrayBuffer field
    data.sharedBuffer = new SharedArrayBuffer(16);
    const view = new Uint8Array(data.sharedBuffer);
    view[0] = 42;
    view[15] = 99;

    // Create a Buffer field backed by SharedArrayBuffer
    const bufferShared = new SharedArrayBuffer(32);
    data.dataBuffer = Buffer.from(bufferShared);
    data.dataBuffer.writeUInt8(123, 0);
    data.dataBuffer.writeUInt32LE(456789, 1);

    // Set timestamp
    data.timestamp = new Date('2024-01-01T00:00:00Z');

    return data;
  }

  @WorkerMethod()
  modifyComplexCustomData(
    @TransportType(() => ComplexCustomData) data: ComplexCustomData,
  ): void {
    // Modify main struct fields
    data.value += 10;
    data.count += 20;

    // Modify nested struct
    if (data.nestedData) {
      data.nestedData.counter += 5;
      data.nestedData.flags = 0xaa;
    }

    // Modify SharedArrayBuffer
    if (data.sharedBuffer) {
      const view = new Uint8Array(data.sharedBuffer);
      view[0] += 1;
      view[15] += 1;
    }

    // Modify Buffer field
    if (data.dataBuffer) {
      const currentByte = data.dataBuffer.readUInt8(0);
      data.dataBuffer.writeUInt8(currentByte + 1, 0);
      const currentInt = data.dataBuffer.readUInt32LE(1);
      data.dataBuffer.writeUInt32LE(currentInt + 100, 1);
    }

    // Update timestamp
    if (data.timestamp) {
      data.timestamp = new Date(data.timestamp.getTime() + 1000);
    }
  }

  @WorkerMethod()
  readComplexCustomData(
    @TransportType(() => ComplexCustomData) data: ComplexCustomData,
  ): {
    value: number;
    count: number;
    nestedCounter?: number;
    nestedFlags?: number;
    sharedByte0?: number;
    sharedByte15?: number;
    bufferByte0?: number;
    bufferInt?: number;
    timestamp?: number;
  } {
    return {
      value: data.value,
      count: data.count,
      nestedCounter: data.nestedData?.counter,
      nestedFlags: data.nestedData?.flags,
      sharedByte0: data.sharedBuffer
        ? new Uint8Array(data.sharedBuffer)[0]
        : undefined,
      sharedByte15: data.sharedBuffer
        ? new Uint8Array(data.sharedBuffer)[15]
        : undefined,
      bufferByte0: data.dataBuffer?.readUInt8(0),
      bufferInt: data.dataBuffer?.readUInt32LE(1),
      timestamp: data.timestamp?.getTime(),
    };
  }

  @WorkerMethod()
  @TransportType(() => DataContainer)
  createDataContainer(): DataContainer {
    const container = new DataContainer('worker-container');

    // Create SharedArrayBuffer-backed Buffer
    const bufferShared = new SharedArrayBuffer(64);
    container.buffer = Buffer.from(bufferShared);
    container.buffer.writeUInt8(77, 0);
    container.buffer.writeUInt32LE(999, 10);

    // Create separate SharedArrayBuffer
    container.shared = new SharedArrayBuffer(32);
    const view = new Uint8Array(container.shared);
    view[0] = 88;
    view[31] = 111;

    // Create nested typed-struct with SharedArrayBuffer
    const nestedShared = new SharedArrayBuffer(NestedStructBase.baseSize);
    const nestedBuffer = Buffer.from(nestedShared);
    container.nestedStruct = new NestedData(nestedBuffer, false);
    container.nestedStruct.counter = 55;
    container.nestedStruct.flags = 0xbb;

    return container;
  }

  @WorkerMethod()
  modifyDataContainer(
    @TransportType(() => DataContainer) container: DataContainer,
  ): void {
    // Modify Buffer field
    if (container.buffer) {
      const byte0 = container.buffer.readUInt8(0);
      container.buffer.writeUInt8(byte0 + 1, 0);
      const int10 = container.buffer.readUInt32LE(10);
      container.buffer.writeUInt32LE(int10 + 10, 10);
    }

    // Modify SharedArrayBuffer
    if (container.shared) {
      const view = new Uint8Array(container.shared);
      view[0] += 1;
      view[31] += 1;
    }

    // Modify nested struct
    if (container.nestedStruct) {
      container.nestedStruct.counter += 10;
      container.nestedStruct.flags = 0xcc;
    }
  }

  @WorkerMethod()
  readDataContainer(
    @TransportType(() => DataContainer) container: DataContainer,
  ): {
    bufferByte0?: number;
    bufferInt10?: number;
    sharedByte0?: number;
    sharedByte31?: number;
    nestedCounter?: number;
    nestedFlags?: number;
  } {
    return {
      bufferByte0: container.buffer?.readUInt8(0),
      bufferInt10: container.buffer?.readUInt32LE(10),
      sharedByte0: container.shared
        ? new Uint8Array(container.shared)[0]
        : undefined,
      sharedByte31: container.shared
        ? new Uint8Array(container.shared)[31]
        : undefined,
      nestedCounter: container.nestedStruct?.counter,
      nestedFlags: container.nestedStruct?.flags,
    };
  }
}
