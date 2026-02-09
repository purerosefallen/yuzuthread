import { ClassType } from 'nfkit';
import { StructConstructor } from 'typed-struct';
import { AnyStructConstructor } from './types';

const hasOwn = (target: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

const hasTypedStructStatics = (
  target: Record<string, unknown>,
  ownOnly: boolean,
): boolean => {
  const hasField = (key: string): boolean =>
    ownOnly ? hasOwn(target, key) : key in target;
  return (
    hasField('baseSize') &&
    typeof target.baseSize === 'number' &&
    hasField('raw') &&
    typeof target.raw === 'function' &&
    hasField('getOffsetOf') &&
    typeof target.getOffsetOf === 'function' &&
    hasField('getOffsets') &&
    typeof target.getOffsets === 'function' &&
    hasField('swap') &&
    typeof target.swap === 'function' &&
    hasField('safeAssign') &&
    typeof target.safeAssign === 'function'
  );
};

const isTypedStructClass = (
  target: unknown,
): target is AnyStructConstructor => {
  if (typeof target !== 'function') return false;
  const value = target as unknown as Record<string, unknown>;
  if (!hasTypedStructStatics(value, false)) return false;
  if (hasTypedStructStatics(value, true)) return true;
  const parent = Object.getPrototypeOf(target);
  if (typeof parent !== 'function') return false;
  return hasTypedStructStatics(
    parent as unknown as Record<string, unknown>,
    true,
  );
};

export const findTypedStructClass = <T>(
  cls: ClassType<T>,
): StructConstructor<T, string> | null => {
  let current: unknown = cls;
  while (typeof current === 'function') {
    if (isTypedStructClass(current))
      return current as StructConstructor<T, string>;
    current = Object.getPrototypeOf(current);
  }
  return null;
};
