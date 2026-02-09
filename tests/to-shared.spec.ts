import { Struct } from 'typed-struct';
import { toShared } from '../src/to-shared';
import { TransportType } from '..';

describe('toShared', () => {
  describe('Buffer handling', () => {
    it('should convert regular Buffer to SharedArrayBuffer-backed Buffer', () => {
      const buffer = Buffer.from([1, 2, 3, 4, 5]);
      const shared = toShared(buffer);

      expect(shared).toBeInstanceOf(Buffer);
      expect(Array.from(shared)).toEqual([1, 2, 3, 4, 5]);
      expect(shared.buffer.constructor.name).toBe('SharedArrayBuffer');
    });

    it('should keep SharedArrayBuffer-backed Buffer as-is', () => {
      const sharedMemory = new SharedArrayBuffer(5);
      const buffer = Buffer.from(sharedMemory);
      buffer.writeUInt8(1, 0);
      buffer.writeUInt8(2, 1);

      const result = toShared(buffer);

      expect(result).toBe(buffer); // Same reference
      expect(result.buffer).toBe(sharedMemory);
    });
  });

  describe('SharedArrayBuffer handling', () => {
    it('should return SharedArrayBuffer as-is', () => {
      const sab = new SharedArrayBuffer(10);
      const result = toShared(sab);

      expect(result).toBe(sab);
    });
  });

  describe('Built-in types', () => {
    it('should return Date as-is', () => {
      const date = new Date();
      const result = toShared(date);

      expect(result).toBe(date);
    });

    it('should return RegExp as-is', () => {
      const regex = /test/g;
      const result = toShared(regex);

      expect(result).toBe(regex);
    });

    it('should return Map as-is', () => {
      const map = new Map([['key', 'value']]);
      const result = toShared(map);

      expect(result).toBe(map);
    });
  });

  describe('Arrays', () => {
    it('should convert array elements in-place', () => {
      const arr = [
        Buffer.from([1, 2, 3]),
        Buffer.from([4, 5, 6]),
        'string',
        123,
      ];

      const result = toShared(arr);

      expect(result).toBe(arr); // Same array reference
      expect((result[0] as Buffer).buffer.constructor.name).toBe('SharedArrayBuffer');
      expect((result[1] as Buffer).buffer.constructor.name).toBe('SharedArrayBuffer');
      expect(result[2]).toBe('string');
      expect(result[3]).toBe(123);
    });

    it('should handle nested arrays', () => {
      const arr = [
        [Buffer.from([1, 2])],
        [Buffer.from([3, 4])],
      ];

      const result = toShared(arr);

      expect(result).toBe(arr);
      expect((result[0][0] as Buffer).buffer.constructor.name).toBe('SharedArrayBuffer');
      expect((result[1][0] as Buffer).buffer.constructor.name).toBe('SharedArrayBuffer');
    });
  });

  describe('User classes', () => {
    class SimpleClass {
      @TransportType(() => Date)
      timestamp: Date;

      @TransportType(() => Buffer)
      buffer?: Buffer;

      constructor() {
        this.timestamp = new Date();
      }
    }

    it('should convert user class fields in-place', () => {
      const obj = new SimpleClass();
      obj.buffer = Buffer.from([1, 2, 3]);

      const result = toShared(obj);

      expect(result).toBe(obj); // Same instance
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer!.buffer.constructor.name).toBe('SharedArrayBuffer');
      expect(result.timestamp).toBe(obj.timestamp); // Date is built-in, not converted
    });

    it('should handle circular references', () => {
      class CircularClass {
        value: number = 0;
        ref?: CircularClass;
      }

      const obj1 = new CircularClass();
      const obj2 = new CircularClass();
      obj1.ref = obj2;
      obj2.ref = obj1;

      const result = toShared(obj1);

      expect(result).toBe(obj1);
      expect(result.ref).toBe(obj2);
      expect(result.ref!.ref).toBe(obj1);
    });
  });

  describe('typed-struct classes', () => {
    const Base = new Struct('ToSharedTestBase')
      .UInt8('value')
      .UInt32LE('counter')
      .compile();

    class SimpleStruct extends Base {
      declare value: number;
      declare counter: number;
    }

    class StructWithFields extends Base {
      declare value: number;
      declare counter: number;

      @TransportType(() => Date)
      timestamp: Date = new Date();

      @TransportType(() => Buffer)
      buffer?: Buffer;
    }

    it('should convert typed-struct to SharedArrayBuffer-backed instance', () => {
      const original = new SimpleStruct();
      original.value = 42;
      original.counter = 100;

      const result = toShared(original);

      expect(result).not.toBe(original); // New instance
      expect(result.value).toBe(42);
      expect(result.counter).toBe(100);

      const raw = Base.raw(result) as Buffer;
      expect(raw.buffer.constructor.name).toBe('SharedArrayBuffer');
    });

    it('should share memory between converted structs', () => {
      const original = new SimpleStruct();
      original.value = 50;
      original.counter = 200;

      const shared = toShared(original);

      // Modify the shared instance
      shared.value = 99;
      shared.counter = 999;

      // Original should not be affected (different instances)
      expect(original.value).toBe(50);
      expect(original.counter).toBe(200);

      // But the shared instance's buffer can be passed to workers
      const raw = Base.raw(shared) as Buffer;
      expect(raw.buffer.constructor.name).toBe('SharedArrayBuffer');
    });

    it('should convert non-struct fields of typed-struct classes', () => {
      const original = new StructWithFields();
      original.value = 77;
      original.counter = 300;
      original.buffer = Buffer.from([1, 2, 3, 4]);

      const result = toShared(original);

      expect(result).not.toBe(original);
      expect(result.value).toBe(77);
      expect(result.counter).toBe(300);

      // Struct buffer should be shared
      const raw = Base.raw(result) as Buffer;
      expect(raw.buffer.constructor.name).toBe('SharedArrayBuffer');

      // Non-struct buffer field should be converted
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer!.buffer.constructor.name).toBe('SharedArrayBuffer');
      expect(Array.from(result.buffer!)).toEqual([1, 2, 3, 4]);

      // Date is built-in, remains as-is
      expect(result.timestamp).toBe(original.timestamp);
    });
  });

  describe('Complex nested structures', () => {
    const Base = new Struct('NestedTestBase')
      .UInt8('id')
      .compile();

    class NestedStruct extends Base {
      declare id: number;
    }

    class Container {
      @TransportType(() => NestedStruct)
      struct?: NestedStruct;

      @TransportType(() => [Buffer])
      buffers: Buffer[] = [];

      metadata: { name: string; value: number } = { name: '', value: 0 };
    }

    it('should handle complex nested structures', () => {
      const container = new Container();
      container.struct = new NestedStruct();
      container.struct.id = 5;
      container.buffers = [
        Buffer.from([1, 2]),
        Buffer.from([3, 4]),
      ];
      container.metadata = { name: 'test', value: 100 };

      const originalStruct = container.struct;
      const result = toShared(container);

      expect(result).toBe(container); // Same instance (in-place modification)
      expect(result.struct).not.toBe(originalStruct); // New struct instance (replaced)

      expect(result.struct!.id).toBe(5);
      const raw = Base.raw(result.struct!) as Buffer;
      expect(raw.buffer.constructor.name).toBe('SharedArrayBuffer');

      expect((result.buffers[0] as Buffer).buffer.constructor.name).toBe('SharedArrayBuffer');
      expect((result.buffers[1] as Buffer).buffer.constructor.name).toBe('SharedArrayBuffer');

      expect(result.metadata).toBe(container.metadata); // Plain object, same ref
    });
  });

  describe('Primitives', () => {
    it('should return primitives as-is', () => {
      expect(toShared(123)).toBe(123);
      expect(toShared('string')).toBe('string');
      expect(toShared(true)).toBe(true);
      expect(toShared(null)).toBe(null);
      expect(toShared(undefined)).toBe(undefined);
    });
  });
});
