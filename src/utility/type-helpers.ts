import { AnyClass } from 'nfkit';
import { findTypedStructClass } from './find-typed-struct-cls';
import { AnyStructConstructor } from './types';

/**
 * Node.js built-in types that should not be recursively processed
 */
export const BUILTIN_TYPES = new Set([
  String,
  Number,
  Boolean,
  Date,
  RegExp,
  Error,
  Map,
  Set,
  WeakMap,
  WeakSet,
  ArrayBuffer,
  SharedArrayBuffer,
  DataView,
  Promise,
  Symbol,
  BigInt,
]);

/**
 * Typed array constructors
 */
export const TYPED_ARRAYS = new Set([
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
]);

/**
 * Check if a class is a built-in type
 *
 * @param cls The class to check
 * @returns true if the class is a built-in type
 */
export const isBuiltinType = (cls: any): boolean => {
  if (!cls) return true;
  if (BUILTIN_TYPES.has(cls)) return true;
  if (TYPED_ARRAYS.has(cls)) return true;
  return false;
};

/**
 * Check if an object is a plain object (not a class instance)
 *
 * @param obj The object to check
 * @returns true if the object is a plain object
 */
export const isPlainObject = (obj: any): boolean => {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
};

/**
 * Get typed-struct field names from a struct class
 *
 * @param structCls The typed-struct class
 * @returns A set of field names
 */
export const getTypedStructFields = (
  structCls: AnyStructConstructor,
): Set<string> => {
  const offsets = structCls.getOffsets();
  return new Set(Object.keys(offsets));
};

/**
 * Get typed-struct information for a class
 *
 * @param cls The class to check
 * @returns Struct information if the class is/extends a typed-struct, null otherwise
 */
export const getTypedStructInfo = (
  cls: AnyClass,
): { structCls: AnyStructConstructor; fields: Set<string> } | null => {
  const structCls = findTypedStructClass(cls);
  if (!structCls) return null;
  const fields = getTypedStructFields(structCls);
  return { structCls, fields };
};
