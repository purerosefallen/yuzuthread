import { Struct } from 'typed-struct';
import { initWorker, TransportType } from '..';
import { BufferTypeTestWorker } from './fixtures/buffer-type-test.worker.js';

describe('Buffer and SharedArrayBuffer Transport', () => {
  const Base = new Struct('BufferSharedBase')
    .UInt8('value')
    .UInt32LE('count')
    .compile();

  const NestedStructBase = new Struct('NestedStructBase')
    .UInt32LE('counter')
    .UInt32LE('flags')
    .compile();

  class NestedData extends NestedStructBase {
    declare counter: number;
    declare flags: number;
  }

  class CustomConstructorData extends Base {
    declare value: number;
    declare count: number;
    customField: string = '';
    userName: string = '';
    
    constructor(userName: string = '', initBuffer?: Buffer, clone?: boolean) {
      // First parameter is custom (userName)! NOT standard (raw?, clone?)
      // Decoder must call: new CustomConstructorData() with no args
      // then use mutateTypedStructProto to inject buffer into super()
      super(initBuffer as any, clone as any);
      this.userName = userName;
      this.customField = 'initialized';
    }
  }

  class ComplexCustomData extends Base {
    declare value: number;
    declare count: number;
    
    customField: string = '';
    label: string = '';
    
    @TransportType(() => NestedData)
    nestedData?: NestedData;
    
    sharedBuffer?: SharedArrayBuffer;
    
    dataBuffer?: Buffer;
    
    @TransportType(() => Date)
    timestamp?: Date;
    
    constructor(label: string = '', initBuffer?: Buffer, clone?: boolean) {
      super(initBuffer as any, clone as any);
      this.label = label;
      this.customField = 'complex';
    }
  }

  class DataContainer {
    label: string = '';
    buffer?: Buffer;
    shared?: SharedArrayBuffer;
    
    @TransportType(() => NestedData)
    nestedStruct?: NestedData;
    
    constructor(label: string = '') {
      this.label = label;
    }
  }

  let worker: Awaited<ReturnType<typeof initWorker<typeof BufferTypeTestWorker>>>;

  beforeAll(async () => {
    worker = await initWorker(BufferTypeTestWorker);
  });

  afterAll(async () => {
    await worker.finalize();
  });

  describe('Buffer transport', () => {
    it('should transport regular Buffer', async () => {
      const buffer = Buffer.alloc(5);
      buffer.writeUInt8(10, 0);
      buffer.writeUInt32LE(100, 1);

      const result = await worker.readBuffer(buffer);
      expect(result.value).toBe(10);
      expect(result.count).toBe(100);
    });

    it('should not share regular Buffer memory', async () => {
      const buffer = Buffer.alloc(5);
      buffer.writeUInt8(20, 0);
      buffer.writeUInt32LE(200, 1);

      await worker.modifyBuffer(buffer);

      // Regular buffer is copied, so main thread doesn't see modification
      expect(buffer.readUInt8(0)).toBe(20);
      expect(buffer.readUInt32LE(1)).toBe(200);
    });

    it('should share Buffer backed by SharedArrayBuffer', async () => {
      const sharedMemory = new SharedArrayBuffer(5);
      const buffer = Buffer.from(sharedMemory);
      buffer.writeUInt8(30, 0);
      buffer.writeUInt32LE(300, 1);

      await worker.modifyBuffer(buffer);

      // SharedArrayBuffer-backed buffer is shared!
      expect(buffer.readUInt8(0)).toBe(99);
      expect(buffer.readUInt32LE(1)).toBe(12345);
    });

    it('should allow bidirectional Buffer modifications', async () => {
      const sharedMemory = new SharedArrayBuffer(5);
      const buffer = Buffer.from(sharedMemory);
      buffer.writeUInt8(40, 0);

      // Modify in worker
      await worker.modifyBuffer(buffer);
      expect(buffer.readUInt8(0)).toBe(99);

      // Modify in main thread
      buffer.writeUInt8(50, 0);

      // Worker should see main thread's modification
      const result = await worker.readBuffer(buffer);
      expect(result.value).toBe(50);
    });
  });

  describe('SharedArrayBuffer transport', () => {
    it('should transport SharedArrayBuffer', async () => {
      const sab = new SharedArrayBuffer(5);
      const view = new Uint8Array(sab);
      view[0] = 60;
      
      const dv = new DataView(sab);
      dv.setUint32(1, 600, true);

      const result = await worker.readSharedArrayBuffer(sab);
      expect(result.value).toBe(60);
      expect(result.count).toBe(600);
    });

    it('should share SharedArrayBuffer memory', async () => {
      const sab = new SharedArrayBuffer(5);
      const view = new Uint8Array(sab);
      view[0] = 70;

      const dv = new DataView(sab);
      dv.setUint32(1, 700, true);

      await worker.modifySharedArrayBuffer(sab);

      // SharedArrayBuffer is shared!
      expect(view[0]).toBe(88);
      expect(dv.getUint32(1, true)).toBe(54321);
    });

    it('should allow bidirectional SharedArrayBuffer modifications', async () => {
      const sab = new SharedArrayBuffer(5);
      const view = new Uint8Array(sab);
      view[0] = 80;

      // Modify in worker
      await worker.modifySharedArrayBuffer(sab);
      expect(view[0]).toBe(88);

      // Modify in main thread
      view[0] = 90;

      // Worker should see main thread's modification
      const result = await worker.readSharedArrayBuffer(sab);
      expect(result.value).toBe(90);
    });
  });

  describe('typed-struct with custom constructor (extreme case)', () => {
    it('should decode typed-struct class with non-standard constructor', async () => {
      // KEY TEST: CustomConstructorData has constructor(userName, initBuffer?, clone?)
      // First parameter is userName (string), NOT buffer!
      // Standard typed-struct signature is (raw?, clone?)
      // 
      // If decoder blindly tried: new CustomConstructorData(buffer, false)
      // userName would receive Buffer object, initBuffer would be false - WRONG!
      //
      // Instead, decoder must call: new CustomConstructorData() with NO args
      // and use mutateTypedStructProto to inject buffer into super()
      const result = await worker.createCustomData();

      expect(result.value).toBe(77);
      expect(result.count).toBe(7777);
      expect(result.customField).toBe('initialized');
      expect(result.userName).toBe('worker-user');

      // Verify SharedArrayBuffer is preserved
      const raw = Base.raw(result);
      expect(raw.buffer.constructor.name).toBe('SharedArrayBuffer');
    });

    it('should correctly decode instance passed back from worker', async () => {
      const result = await worker.createCustomData();
      
      const initialValue = result.value;
      const initialCount = result.count;
      
      // Pass it back to worker - this exercises the decoder again
      // Decoder must handle the custom constructor correctly
      await worker.modifyCustomData(result);
      
      // Note: When worker creates SharedArrayBuffer and returns it,
      // then receives it back as parameter, struct fields are not necessarily shared
      // (the round-trip encoding/decoding may create separate buffers).
      // Non-struct fields are definitely not shared (they're copied).
      // The key here is that decoding works without error despite custom constructor.
      expect(result.customField).toBe('initialized'); // Not shared
      expect(result.userName).toBe('worker-user'); // Preserved but not modified by worker
      expect(result.value).toBe(initialValue); // Not shared in round-trip
      expect(result.count).toBe(initialCount); // Not shared in round-trip
    });

    it('should handle SharedArrayBuffer when main thread creates instance', async () => {
      // This is the proper way to use SharedArrayBuffer:
      // Main thread creates the instance with SharedArrayBuffer
      const sharedMemory = new SharedArrayBuffer(Base.baseSize);
      const buffer = Buffer.from(sharedMemory);
      const instance = new CustomConstructorData('main-user', buffer, false);
      instance.value = 100;
      instance.count = 1000;

      // Send to worker for modification
      await worker.modifyCustomData(instance);

      // SharedArrayBuffer should be properly shared
      expect(instance.value).toBe(101); // Shared via SharedArrayBuffer
      expect(instance.count).toBe(1001); // Shared via SharedArrayBuffer
      expect(instance.customField).toBe('initialized'); // Not shared (regular field)
      expect(instance.userName).toBe('main-user'); // Preserved
    });
  });

  describe('Complex custom constructor with mixed transport fields', () => {
    it('should handle complex class with nested typed-struct and SharedArrayBuffer', async () => {
      // Worker creates a complex instance with:
      // - Custom constructor
      // - Nested typed-struct (with SharedArrayBuffer)
      // - Separate SharedArrayBuffer field
      // - Buffer field (backed by SharedArrayBuffer)
      // - Date field with @TransportType
      const result = await worker.createComplexCustomData();

      // Verify main struct
      expect(result.value).toBe(100);
      expect(result.count).toBe(200);
      expect(result.customField).toBe('complex');
      expect(result.label).toBe('worker-complex');

      // Verify nested typed-struct
      expect(result.nestedData).toBeDefined();
      expect(result.nestedData!.counter).toBe(50);
      expect(result.nestedData!.flags).toBe(0xFF);

      // Verify SharedArrayBuffer field
      expect(result.sharedBuffer).toBeDefined();
      expect(result.sharedBuffer!.constructor.name).toBe('SharedArrayBuffer');
      const view = new Uint8Array(result.sharedBuffer!);
      expect(view[0]).toBe(42);
      expect(view[15]).toBe(99);

      // Verify Buffer field (backed by SharedArrayBuffer)
      expect(result.dataBuffer).toBeDefined();
      expect(result.dataBuffer!.buffer.constructor.name).toBe('SharedArrayBuffer');
      expect(result.dataBuffer!.readUInt8(0)).toBe(123);
      expect(result.dataBuffer!.readUInt32LE(1)).toBe(456789);

      // Verify Date field
      expect(result.timestamp).toBeDefined();
      expect(result.timestamp!.toISOString()).toBe('2024-01-01T00:00:00.000Z');

      // Verify main struct uses SharedArrayBuffer
      const raw = Base.raw(result);
      expect(raw.buffer.constructor.name).toBe('SharedArrayBuffer');

      // Verify nested struct uses SharedArrayBuffer
      const nestedRaw = NestedStructBase.raw(result.nestedData!);
      expect(nestedRaw.buffer.constructor.name).toBe('SharedArrayBuffer');
    });

    it('should handle main-thread created complex instance with shared memory', async () => {
      // Main thread creates instance with SharedArrayBuffer
      const mainShared = new SharedArrayBuffer(Base.baseSize);
      const mainBuffer = Buffer.from(mainShared);
      const data = new ComplexCustomData('main-complex', mainBuffer, false);
      data.value = 50;
      data.count = 100;

      // Create nested typed-struct with SharedArrayBuffer
      const nestedShared = new SharedArrayBuffer(NestedStructBase.baseSize);
      const nestedBuffer = Buffer.from(nestedShared);
      data.nestedData = new NestedData(nestedBuffer, false);
      data.nestedData.counter = 10;
      data.nestedData.flags = 0x11;

      // Create SharedArrayBuffer field
      data.sharedBuffer = new SharedArrayBuffer(16);
      const view = new Uint8Array(data.sharedBuffer);
      view[0] = 5;
      view[15] = 10;

      // Create Buffer field backed by SharedArrayBuffer
      const bufferShared = new SharedArrayBuffer(32);
      data.dataBuffer = Buffer.from(bufferShared);
      data.dataBuffer.writeUInt8(20, 0);
      data.dataBuffer.writeUInt32LE(300, 1);

      // Set timestamp
      data.timestamp = new Date('2023-01-01T00:00:00Z');

      // Send to worker for modification
      await worker.modifyComplexCustomData(data);

      // Verify main struct modified via SharedArrayBuffer
      expect(data.value).toBe(60); // 50 + 10
      expect(data.count).toBe(120); // 100 + 20

      // Verify nested struct modified via SharedArrayBuffer
      expect(data.nestedData!.counter).toBe(15); // 10 + 5
      expect(data.nestedData!.flags).toBe(0xAA);

      // Verify SharedArrayBuffer field modified
      expect(view[0]).toBe(6); // 5 + 1
      expect(view[15]).toBe(11); // 10 + 1

      // Verify Buffer field modified via SharedArrayBuffer
      expect(data.dataBuffer!.readUInt8(0)).toBe(21); // 20 + 1
      expect(data.dataBuffer!.readUInt32LE(1)).toBe(400); // 300 + 100

      // Verify non-shared fields preserved
      expect(data.customField).toBe('complex');
      expect(data.label).toBe('main-complex');
      // Timestamp is not shared (Date is copied)
      expect(data.timestamp!.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    });

    it('should verify bidirectional shared memory access', async () => {
      const mainShared = new SharedArrayBuffer(Base.baseSize);
      const mainBuffer = Buffer.from(mainShared);
      const data = new ComplexCustomData('bidirectional', mainBuffer, false);
      data.value = 1;
      data.count = 2;

      const nestedShared = new SharedArrayBuffer(NestedStructBase.baseSize);
      const nestedBuffer = Buffer.from(nestedShared);
      data.nestedData = new NestedData(nestedBuffer, false);
      data.nestedData.counter = 3;
      data.nestedData.flags = 4;

      data.sharedBuffer = new SharedArrayBuffer(16);
      const view = new Uint8Array(data.sharedBuffer);
      view[0] = 5;

      const bufferShared = new SharedArrayBuffer(32);
      data.dataBuffer = Buffer.from(bufferShared);
      data.dataBuffer.writeUInt8(6, 0);
      data.dataBuffer.writeUInt32LE(700, 1);

      // Worker reads initial values
      let readResult = await worker.readComplexCustomData(data);
      expect(readResult.value).toBe(1);
      expect(readResult.count).toBe(2);
      expect(readResult.nestedCounter).toBe(3);
      expect(readResult.nestedFlags).toBe(4);
      expect(readResult.sharedByte0).toBe(5);
      expect(readResult.bufferByte0).toBe(6);
      expect(readResult.bufferInt).toBe(700);

      // Main thread modifies
      data.value = 10;
      data.count = 20;
      data.nestedData.counter = 30;
      data.nestedData.flags = 40;
      view[0] = 50;
      data.dataBuffer.writeUInt8(60, 0);
      data.dataBuffer.writeUInt32LE(8000, 1);

      // Worker sees modifications (shared memory)
      readResult = await worker.readComplexCustomData(data);
      expect(readResult.value).toBe(10);
      expect(readResult.count).toBe(20);
      expect(readResult.nestedCounter).toBe(30);
      expect(readResult.nestedFlags).toBe(40);
      expect(readResult.sharedByte0).toBe(50);
      expect(readResult.bufferByte0).toBe(60);
      expect(readResult.bufferInt).toBe(8000);

      // Worker modifies
      await worker.modifyComplexCustomData(data);

      // Main thread sees modifications
      expect(data.value).toBe(20); // 10 + 10
      expect(data.count).toBe(40); // 20 + 20
      expect(data.nestedData.counter).toBe(35); // 30 + 5
      expect(data.nestedData.flags).toBe(0xAA);
      expect(view[0]).toBe(51); // 50 + 1
      expect(data.dataBuffer.readUInt8(0)).toBe(61); // 60 + 1
      expect(data.dataBuffer.readUInt32LE(1)).toBe(8100); // 8000 + 100
    });

    it('should handle round-trip with worker-created complex instance', async () => {
      const result = await worker.createComplexCustomData();

      const initialValue = result.value;
      const initialNestedCounter = result.nestedData!.counter;
      const initialSharedByte0 = new Uint8Array(result.sharedBuffer!)[0];

      // Send back to worker
      await worker.modifyComplexCustomData(result);

      // Interesting: SharedArrayBuffer field IS shared even in round-trip!
      // The structured clone algorithm preserves SharedArrayBuffer references
      expect(new Uint8Array(result.sharedBuffer!)[0]).toBe(initialSharedByte0 + 1); // 42 + 1 = 43
      expect(new Uint8Array(result.sharedBuffer!)[15]).toBe(100); // 99 + 1 = 100

      // But typed-struct buffers are NOT shared in round-trip
      // (because we encode them to intermediate format and decode back)
      expect(result.value).toBe(initialValue);
      expect(result.nestedData!.counter).toBe(initialNestedCounter);

      // Non-struct fields preserved
      expect(result.customField).toBe('complex');
      expect(result.label).toBe('worker-complex');
    });
  });

  describe('Regular class with Buffer fields', () => {
    it('should handle regular class with Buffer and SharedArrayBuffer fields', async () => {
      // Worker creates a regular (non-typed-struct) class with:
      // - Buffer field backed by SharedArrayBuffer
      // - Direct SharedArrayBuffer field
      // - Nested typed-struct field
      const result = await worker.createDataContainer();

      expect(result.label).toBe('worker-container');

      // Verify Buffer field
      expect(result.buffer).toBeDefined();
      expect(result.buffer!.buffer.constructor.name).toBe('SharedArrayBuffer');
      expect(result.buffer!.readUInt8(0)).toBe(77);
      expect(result.buffer!.readUInt32LE(10)).toBe(999);

      // Verify SharedArrayBuffer field
      expect(result.shared).toBeDefined();
      expect(result.shared!.constructor.name).toBe('SharedArrayBuffer');
      const view = new Uint8Array(result.shared!);
      expect(view[0]).toBe(88);
      expect(view[31]).toBe(111);

      // Verify nested typed-struct
      expect(result.nestedStruct).toBeDefined();
      expect(result.nestedStruct!.counter).toBe(55);
      expect(result.nestedStruct!.flags).toBe(0xBB);
      const nestedRaw = NestedStructBase.raw(result.nestedStruct!);
      expect(nestedRaw.buffer.constructor.name).toBe('SharedArrayBuffer');
    });

    it('should handle main-thread created DataContainer with shared memory', async () => {
      const container = new DataContainer('main-container');

      // Create Buffer field with SharedArrayBuffer
      const bufferShared = new SharedArrayBuffer(64);
      container.buffer = Buffer.from(bufferShared);
      container.buffer.writeUInt8(10, 0);
      container.buffer.writeUInt32LE(20, 10);

      // Create SharedArrayBuffer field
      container.shared = new SharedArrayBuffer(32);
      const view = new Uint8Array(container.shared);
      view[0] = 30;
      view[31] = 40;

      // Create nested typed-struct with SharedArrayBuffer
      const nestedShared = new SharedArrayBuffer(NestedStructBase.baseSize);
      const nestedBuffer = Buffer.from(nestedShared);
      container.nestedStruct = new NestedData(nestedBuffer, false);
      container.nestedStruct.counter = 50;
      container.nestedStruct.flags = 0xDD;

      // Send to worker for modification
      await worker.modifyDataContainer(container);

      // Verify all fields modified via SharedArrayBuffer
      expect(container.buffer!.readUInt8(0)).toBe(11); // 10 + 1
      expect(container.buffer!.readUInt32LE(10)).toBe(30); // 20 + 10
      expect(view[0]).toBe(31); // 30 + 1
      expect(view[31]).toBe(41); // 40 + 1
      expect(container.nestedStruct!.counter).toBe(60); // 50 + 10
      expect(container.nestedStruct!.flags).toBe(0xCC);

      // Label preserved
      expect(container.label).toBe('main-container');
    });

    it('should verify bidirectional Buffer field sharing', async () => {
      const container = new DataContainer('bidirectional');

      // Create all fields with SharedArrayBuffer
      const bufferShared = new SharedArrayBuffer(64);
      container.buffer = Buffer.from(bufferShared);
      container.buffer.writeUInt8(100, 0);
      container.buffer.writeUInt32LE(200, 10);

      container.shared = new SharedArrayBuffer(32);
      const view = new Uint8Array(container.shared);
      view[0] = 1;
      view[31] = 2;

      const nestedShared = new SharedArrayBuffer(NestedStructBase.baseSize);
      const nestedBuffer = Buffer.from(nestedShared);
      container.nestedStruct = new NestedData(nestedBuffer, false);
      container.nestedStruct.counter = 3;
      container.nestedStruct.flags = 4;

      // Worker reads initial values
      let readResult = await worker.readDataContainer(container);
      expect(readResult.bufferByte0).toBe(100);
      expect(readResult.bufferInt10).toBe(200);
      expect(readResult.sharedByte0).toBe(1);
      expect(readResult.sharedByte31).toBe(2);
      expect(readResult.nestedCounter).toBe(3);
      expect(readResult.nestedFlags).toBe(4);

      // Main thread modifies all fields
      container.buffer.writeUInt8(110, 0);
      container.buffer.writeUInt32LE(220, 10);
      view[0] = 11;
      view[31] = 22;
      container.nestedStruct.counter = 33;
      container.nestedStruct.flags = 44;

      // Worker sees all modifications
      readResult = await worker.readDataContainer(container);
      expect(readResult.bufferByte0).toBe(110);
      expect(readResult.bufferInt10).toBe(220);
      expect(readResult.sharedByte0).toBe(11);
      expect(readResult.sharedByte31).toBe(22);
      expect(readResult.nestedCounter).toBe(33);
      expect(readResult.nestedFlags).toBe(44);

      // Worker modifies
      await worker.modifyDataContainer(container);

      // Main thread sees modifications
      expect(container.buffer!.readUInt8(0)).toBe(111); // 110 + 1
      expect(container.buffer!.readUInt32LE(10)).toBe(230); // 220 + 10
      expect(view[0]).toBe(12); // 11 + 1
      expect(view[31]).toBe(23); // 22 + 1
      expect(container.nestedStruct!.counter).toBe(43); // 33 + 10
      expect(container.nestedStruct!.flags).toBe(0xCC);
    });

    it('should handle round-trip with worker-created DataContainer', async () => {
      const result = await worker.createDataContainer();

      // Interesting: Both Buffer and SharedArrayBuffer are shared in round-trip
      const initialBufferByte = result.buffer!.readUInt8(0);
      const initialSharedByte = new Uint8Array(result.shared!)[0];
      const initialNestedCounter = result.nestedStruct!.counter;

      // Send back to worker
      await worker.modifyDataContainer(result);

      // Buffer field IS shared (SharedArrayBuffer reference preserved)
      expect(result.buffer!.readUInt8(0)).toBe(initialBufferByte + 1);
      expect(result.buffer!.readUInt32LE(10)).toBe(1009); // 999 + 10

      // SharedArrayBuffer field IS shared
      expect(new Uint8Array(result.shared!)[0]).toBe(initialSharedByte + 1);
      expect(new Uint8Array(result.shared!)[31]).toBe(112); // 111 + 1

      // Nested typed-struct buffer NOT shared in round-trip
      expect(result.nestedStruct!.counter).toBe(initialNestedCounter);

      // Non-shared field preserved
      expect(result.label).toBe('worker-container');
    });
  });

  describe('Buffer and SharedArrayBuffer edge cases', () => {
    it('should handle Buffer with offset', async () => {
      const sharedMemory = new SharedArrayBuffer(10);
      const fullBuffer = Buffer.from(sharedMemory);
      
      // Write to the full buffer
      fullBuffer.writeUInt8(11, 5);
      fullBuffer.writeUInt32LE(111, 6);

      // Create a sliced buffer
      const slicedBuffer = fullBuffer.subarray(5, 10);
      
      const result = await worker.readBuffer(slicedBuffer);
      expect(result.value).toBe(11);
      expect(result.count).toBe(111);
    });

    it('should handle empty Buffer', async () => {
      const buffer = Buffer.alloc(0);
      
      // Empty buffer cannot be read, expect error
      await expect(worker.readBuffer(buffer)).rejects.toThrow();
    });

    it('should handle small SharedArrayBuffer', async () => {
      const sab = new SharedArrayBuffer(1);
      const view = new Uint8Array(sab);
      view[0] = 42;

      const result = await worker.readSharedArrayBuffer(sab);
      expect(result.value).toBe(42);
      expect(result.count).toBeUndefined();
    });
  });
});
