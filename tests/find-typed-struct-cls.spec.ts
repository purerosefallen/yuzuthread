import { Struct } from 'typed-struct';
import { findTypedStructClass } from '../src/find-typed-struct-cls';

describe('findTypedStructClass', () => {
  const BaseStruct = new Struct('BaseStruct').UInt8('id').compile();

  class DerivedStruct extends BaseStruct {}

  class NotTypedStruct {
    id = 1;
  }

  it('should return the class itself when cls is a typed-struct class', () => {
    expect(findTypedStructClass(BaseStruct)).toBe(BaseStruct);
  });

  it('should return the first typed-struct class in the prototype chain', () => {
    expect(findTypedStructClass(DerivedStruct)).toBe(BaseStruct);
  });

  it('should allow operating the same raw buffer via DerivedStruct fields', () => {
    const typedStructClass = findTypedStructClass(DerivedStruct);
    expect(typedStructClass).toBe(BaseStruct);

    const item = new DerivedStruct();
    item.id = 0x12;

    const raw = typedStructClass!.raw(item);
    expect(raw[0]).toBe(0x12);

    raw[0] = 0x34;
    expect(item.id).toBe(0x34);
  });

  it('should return null when no typed-struct class is found', () => {
    expect(findTypedStructClass(NotTypedStruct)).toBeNull();
  });
});
