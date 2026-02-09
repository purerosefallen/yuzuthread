import { Struct } from 'typed-struct';
import {
  Shared,
  getSharedParams,
  hasSharedMemorySegments,
  calculateSharedMemorySize,
} from '../src/utility/shared-decorator';
import { TransportType } from '../src/utility/transport-metadata';

const Base = new Struct('SharedDecoratorBase').UInt32LE('value').compile();

class SharedStruct extends Base {
  declare value: number;
}

class BufferContainer {
  @TransportType(() => Buffer)
  buffer: Buffer;

  constructor() {
    this.buffer = Buffer.alloc(10);
  }
}

class NestedSharedContainer {
  @TransportType(() => SharedStruct)
  data: SharedStruct;

  constructor() {
    this.data = new SharedStruct();
  }
}

class NoSharedMemory {
  value: number = 0;
  name: string = '';
}

describe('Shared decorator utilities', () => {
  describe('hasSharedMemorySegments', () => {
    it('should detect typed-struct classes', () => {
      expect(hasSharedMemorySegments(SharedStruct)).toBe(true);
    });

    it('should detect Buffer type', () => {
      expect(hasSharedMemorySegments(Buffer)).toBe(true);
    });

    it('should detect SharedArrayBuffer type', () => {
      expect(hasSharedMemorySegments(SharedArrayBuffer)).toBe(true);
    });

    it('should detect user classes with Buffer fields', () => {
      expect(hasSharedMemorySegments(BufferContainer)).toBe(true);
    });

    it('should detect user classes with nested typed-struct fields', () => {
      expect(hasSharedMemorySegments(NestedSharedContainer)).toBe(true);
    });

    it('should return false for classes without shared memory', () => {
      expect(hasSharedMemorySegments(NoSharedMemory)).toBe(false);
    });

    it('should return false for built-in types', () => {
      expect(hasSharedMemorySegments(String)).toBe(false);
      expect(hasSharedMemorySegments(Number)).toBe(false);
      expect(hasSharedMemorySegments(Date)).toBe(false);
    });

    it('should throw error for circular type references', () => {
      class CircularB {
        @TransportType(() => CircularA)
        a?: any; // Use any to avoid TS error
      }

      class CircularA {
        @TransportType(() => CircularB)
        b?: CircularB;
      }

      // Should throw error on circular reference
      expect(() => hasSharedMemorySegments(CircularA)).toThrow(
        'Circular reference detected',
      );
    });
  });

  describe('calculateSharedMemorySize', () => {
    it('should calculate size for typed-struct', () => {
      const struct = new SharedStruct();
      const size = calculateSharedMemorySize(struct);
      expect(size).toBe(4); // UInt32LE
    });

    it('should calculate size for Buffer', () => {
      const buffer = Buffer.alloc(100);
      const size = calculateSharedMemorySize(buffer);
      expect(size).toBe(100);
    });

    it('should return 0 for already-shared Buffer', () => {
      const sharedBuffer = Buffer.from(new SharedArrayBuffer(50));
      const size = calculateSharedMemorySize(sharedBuffer);
      expect(size).toBe(0);
    });

    it('should return 0 for SharedArrayBuffer', () => {
      const sab = new SharedArrayBuffer(100);
      const size = calculateSharedMemorySize(sab);
      expect(size).toBe(0);
    });

    it('should calculate size for user class with Buffer field', () => {
      const container = new BufferContainer();
      container.buffer = Buffer.alloc(20);
      const size = calculateSharedMemorySize(container);
      expect(size).toBe(20);
    });

    it('should calculate size for nested structures', () => {
      const container = new NestedSharedContainer();
      container.data.value = 42;
      const size = calculateSharedMemorySize(container);
      expect(size).toBe(4); // UInt32LE from SharedStruct
    });

    it('should handle arrays', () => {
      const struct1 = new SharedStruct();
      const struct2 = new SharedStruct();
      const arr = [struct1, struct2];
      const size = calculateSharedMemorySize(arr);
      expect(size).toBe(8); // 2 * 4 bytes
    });

    it('should return 0 for objects without shared memory', () => {
      const obj = new NoSharedMemory();
      const size = calculateSharedMemorySize(obj);
      expect(size).toBe(0);
    });

    it('should throw error for circular object references', () => {
      const struct = new SharedStruct();
      const container: any = { struct };
      container.self = container; // Circular reference

      expect(() => calculateSharedMemorySize(container)).toThrow(
        'Circular reference detected',
      );
    });
  });

  describe('@Shared decorator', () => {
    it('should register metadata for typed-struct parameters', () => {
      class TestClass {
        constructor(@Shared(() => SharedStruct) data: SharedStruct) {}
      }

      const params = getSharedParams(TestClass);
      expect(params.size).toBe(1);
      expect(params.has(0)).toBe(true);

      const param = params.get(0);
      expect(param).toBeDefined();
      expect(param?.index).toBe(0);
      expect(param?.factory).toBeDefined();
      expect(param?.factory?.()).toBe(SharedStruct);
    });

    it('should register metadata for Buffer parameters', () => {
      class TestClass {
        constructor(@Shared(() => Buffer) buffer: Buffer) {}
      }

      const params = getSharedParams(TestClass);
      expect(params.size).toBe(1);
      expect(params.get(0)?.factory?.()).toBe(Buffer);
    });

    it('should work without factory if design:paramtypes is available', () => {
      class TestClass {
        constructor(@Shared() data: SharedStruct) {}
      }

      const params = getSharedParams(TestClass);
      expect(params.size).toBe(1);
      expect(params.has(0)).toBe(true);
    });

    it('should handle multiple @Shared parameters', () => {
      class TestClass {
        constructor(
          @Shared(() => SharedStruct) data1: SharedStruct,
          @Shared(() => BufferContainer) data2: BufferContainer,
          @Shared(() => Buffer) buffer: Buffer,
        ) {}
      }

      const params = getSharedParams(TestClass);
      expect(params.size).toBe(3);
      expect(params.has(0)).toBe(true);
      expect(params.has(1)).toBe(true);
      expect(params.has(2)).toBe(true);
    });

    it('should throw error for parameters without shared memory', () => {
      expect(() => {
        class TestClass {
          constructor(@Shared(() => NoSharedMemory) data: NoSharedMemory) {}
        }
      }).toThrow('does not contain any shared memory segments');
    });

    it('should throw error for built-in types', () => {
      expect(() => {
        class TestClass {
          constructor(@Shared(() => Date) date: Date) {}
        }
      }).toThrow('does not contain any shared memory segments');
    });

    it('should throw error when used on non-constructor parameters', () => {
      expect(() => {
        class TestClass {
          method(@Shared(() => SharedStruct) data: SharedStruct): void {}
        }
      }).toThrow('@Shared can only be used on constructor parameters');
    });

    it('should throw error when parameter type is Object (no specific type info)', () => {
      expect(() => {
        // With emitDecoratorMetadata but type is 'any' (becomes Object in design:paramtypes)
        class TestClass {
          constructor(@Shared() data: any) {}
        }
      }).toThrow('does not contain any shared memory segments');
    });
  });
});
