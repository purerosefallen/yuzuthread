import { Struct } from 'typed-struct';
import {
  scanTypedStructClass,
  getTypedStructInfo,
  createTypedStructInstance,
} from '../src/utility/typed-struct-registry';

describe('TypedStructRegistry', () => {
  const Base = new Struct('TestBase')
    .UInt8('value')
    .UInt32LE('count')
    .compile();

  // Class that directly extends Base without custom constructor
  class DirectChild extends Base {
    declare value: number;
    declare count: number;
  }

  // Class with custom constructor
  class CustomConstructor extends Base {
    declare value: number;
    declare count: number;
    extraField: string = '';

    constructor(label: string = '', raw?: Buffer, clone?: boolean) {
      super(raw as any, clone as any);
      this.extraField = label;
    }
  }

  // Regular class (not typed-struct)
  class RegularClass {
    value: number = 0;
  }

  describe('scanTypedStructClass', () => {
    it('should scan and identify base class', () => {
      scanTypedStructClass(Base);
      const info = getTypedStructInfo(Base);

      expect(info).toBeDefined();
      expect(info!.isBaseClass).toBe(true);
      expect(info!.baseClass).toBe(Base);
      expect(info!.mutated).toBe(false);
    });

    it('should scan and identify direct child without custom constructor', () => {
      scanTypedStructClass(DirectChild);
      const info = getTypedStructInfo(DirectChild);

      expect(info).toBeDefined();
      expect(info!.baseClass).toBe(Base);
      // DirectChild will be mutated since TypeScript generates an implicit constructor
      expect(info!.mutated).toBe(true);
    });

    it('should scan and mutate class with custom constructor', () => {
      scanTypedStructClass(CustomConstructor);
      const info = getTypedStructInfo(CustomConstructor);

      expect(info).toBeDefined();
      expect(info!.isBaseClass).toBe(false);
      expect(info!.baseClass).toBe(Base);
      expect(info!.mutated).toBe(true);
    });

    it('should handle non-typed-struct class', () => {
      scanTypedStructClass(RegularClass);
      const info = getTypedStructInfo(RegularClass);

      expect(info).toBeNull();
    });

    it('should only scan once (idempotent)', () => {
      scanTypedStructClass(CustomConstructor);
      const info1 = getTypedStructInfo(CustomConstructor);

      scanTypedStructClass(CustomConstructor);
      const info2 = getTypedStructInfo(CustomConstructor);

      expect(info1).toBe(info2); // Same object reference
    });
  });

  describe('createTypedStructInstance', () => {
    it('should create base class instance', () => {
      const buffer = Buffer.alloc(Base.baseSize);
      buffer.writeUInt8(42, 0);
      buffer.writeUInt32LE(100, 1);

      const instance = createTypedStructInstance(Base, buffer, false);

      expect(instance.value).toBe(42);
      expect(instance.count).toBe(100);
    });

    it('should create direct child instance', () => {
      const buffer = Buffer.alloc(Base.baseSize);
      buffer.writeUInt8(55, 0);
      buffer.writeUInt32LE(200, 1);

      const instance = createTypedStructInstance(DirectChild, buffer, false);

      expect(instance.value).toBe(55);
      expect(instance.count).toBe(200);
    });

    it('should create custom constructor instance with args', () => {
      const buffer = Buffer.alloc(Base.baseSize);
      buffer.writeUInt8(77, 0);
      buffer.writeUInt32LE(300, 1);

      const instance = createTypedStructInstance(
        CustomConstructor,
        buffer,
        false,
        ['test-label'],
      );

      expect(instance.value).toBe(77);
      expect(instance.count).toBe(300);
      expect(instance.extraField).toBe('test-label');
    });

    it('should handle SharedArrayBuffer', () => {
      const sharedMemory = new SharedArrayBuffer(Base.baseSize);
      const buffer = Buffer.from(sharedMemory);
      buffer.writeUInt8(99, 0);
      buffer.writeUInt32LE(400, 1);

      const instance = createTypedStructInstance(
        CustomConstructor,
        buffer,
        false,
        ['shared'],
      );

      expect(instance.value).toBe(99);
      expect(instance.count).toBe(400);
      expect(instance.extraField).toBe('shared');

      // Verify it's using the SharedArrayBuffer
      const raw = Base.raw(instance);
      expect(raw.buffer).toBe(sharedMemory);
    });

    it('should throw for non-typed-struct class', () => {
      const buffer = Buffer.alloc(10);

      expect(() => {
        createTypedStructInstance(RegularClass as any, buffer, false);
      }).toThrow();
    });
  });
});
