import { Struct } from 'typed-struct';
import { findTypedStructClass } from '../src/find-typed-struct-cls';
import { mutateTypedStructProto } from '../src/mutate-typed-struct-proto';

describe('mutateTypedStructProto', () => {
  const BaseStruct = new Struct('BaseStruct').UInt8('id').compile();

  class DerivedStruct extends BaseStruct {}

  class NotTypedStruct {
    id = 1;
  }

  it('should mutate constructor args with cb result', () => {
    const before = new DerivedStruct([0x11]);
    expect(before.id).toBe(0x11);

    const values = [0x22, 0x33];
    let callCount = 0;
    const result = mutateTypedStructProto(DerivedStruct, () => {
      const value = values[callCount];
      callCount += 1;
      return [[value]];
    });
    expect(result).toBe(true);

    const item1 = new DerivedStruct([0xaa]);
    const item2 = new DerivedStruct([0xbb]);

    expect(item1.id).toBe(0x22);
    expect(item2.id).toBe(0x33);
    expect(callCount).toBe(2);

    const typedStructClass = findTypedStructClass(DerivedStruct);
    expect(typedStructClass).not.toBeNull();
    expect(typedStructClass!.raw(item1)[0]).toBe(0x22);
  });

  it('should return false when typed-struct class is not found', () => {
    expect(mutateTypedStructProto(NotTypedStruct, () => [[0x44]])).toBe(false);
  });

  it('should replace previous cb when called again', () => {
    const BaseStruct2 = new Struct('BaseStruct2').UInt8('id').compile();
    class DerivedStruct2 extends BaseStruct2 {}

    let firstCbCalls = 0;
    expect(
      mutateTypedStructProto(DerivedStruct2, () => {
        firstCbCalls += 1;
        return [[0x12]];
      }),
    ).toBe(true);

    expect(new DerivedStruct2([0xaa]).id).toBe(0x12);
    expect(firstCbCalls).toBe(1);

    let secondCbCalls = 0;
    expect(
      mutateTypedStructProto(DerivedStruct2, () => {
        secondCbCalls += 1;
        return [[0x34]];
      }),
    ).toBe(true);

    expect(new DerivedStruct2([0xbb]).id).toBe(0x34);
    expect(secondCbCalls).toBe(1);
    expect(firstCbCalls).toBe(1);
  });

  it('should keep original constructor args when cb returns undefined', () => {
    const BaseStruct3 = new Struct('BaseStruct3').UInt8('id').compile();
    class DerivedStruct3 extends BaseStruct3 {}

    let cbCalls = 0;
    expect(
      mutateTypedStructProto(DerivedStruct3, () => {
        cbCalls += 1;
        return undefined;
      }),
    ).toBe(true);

    expect(new DerivedStruct3([0x56]).id).toBe(0x56);
    expect(cbCalls).toBe(1);
  });
});
