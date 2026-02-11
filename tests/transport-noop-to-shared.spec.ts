import { toShared, TransportNoop, TransportType } from '..';

const NoopPropertyDecorator = (): PropertyDecorator => () => {};

describe('TransportNoop with toShared', () => {
  it('should not process field with TransportNoop in toShared', () => {
    class NestedData {
      value!: string;

      constructor(value: string) {
        this.value = value;
      }
    }

    class DataWithNoop {
      normalField!: NestedData;

      @TransportNoop()
      noopField?: NestedData;

      constructor(normalField: NestedData, noopField?: NestedData) {
        this.normalField = normalField;
        this.noopField = noopField;
      }
    }

    const nested1 = new NestedData('normal');
    const nested2 = new NestedData('noop');
    const input = new DataWithNoop(nested1, nested2);

    const result = toShared(input);

    // normalField should be processed (same reference after toShared for non-struct classes)
    expect(result.normalField).toBe(nested1);

    // noopField should NOT be processed by toShared (TransportNoop prevents processing)
    expect(result.noopField).toBe(nested2);

    // Both should keep their original values since toShared modifies in-place for user classes
    expect(result.normalField.value).toBe('normal');
    expect(result.noopField?.value).toBe('noop');
  });

  it('should not process array field with TransportNoop', () => {
    class DataWithNoopArray {
      normalArray!: string[];

      @TransportNoop()
      noopArray?: string[];

      constructor(normalArray: string[], noopArray?: string[]) {
        this.normalArray = normalArray;
        this.noopArray = noopArray;
      }
    }

    const normalArr = ['a', 'b', 'c'];
    const noopArr = ['x', 'y', 'z'];
    const input = new DataWithNoopArray(normalArr, noopArr);

    const result = toShared(input);

    // Both arrays should be the same references (toShared doesn't process primitives in arrays)
    expect(result.normalArray).toBe(normalArr);
    expect(result.noopArray).toBe(noopArr);
  });

  it('should not process nested object with TransportNoop', () => {
    class DataWithNoopNested {
      @NoopPropertyDecorator()
      bufferNormal!: Buffer;

      @TransportNoop()
      bufferNoop?: Buffer;

      constructor(bufferNormal: Buffer, bufferNoop?: Buffer) {
        this.bufferNormal = bufferNormal;
        this.bufferNoop = bufferNoop;
      }
    }

    const buffer1 = Buffer.from('normal');
    const buffer2 = Buffer.from('noop');
    const input = new DataWithNoopNested(buffer1, buffer2);

    const result = toShared(input);

    // bufferNormal should be converted to SharedArrayBuffer
    expect(Buffer.isBuffer(result.bufferNormal)).toBe(true);
    expect(result.bufferNormal.buffer).toBeInstanceOf(SharedArrayBuffer);

    // bufferNoop should NOT be converted (TransportNoop prevents processing)
    expect(Buffer.isBuffer(result.bufferNoop!)).toBe(true);
    expect(result.bufferNoop!.buffer).not.toBeInstanceOf(SharedArrayBuffer);
  });
});
