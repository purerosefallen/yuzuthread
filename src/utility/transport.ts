import { AnyClass } from 'nfkit';
import {
  TransporterInfo,
  getReturnTransporter,
  getParamTransporters,
  getPropertyTransporter,
  transportReflector,
} from './transport-metadata';
import { findTypedStructClass } from './find-typed-struct-cls';
import { AnyStructConstructor } from './types';

type TransportContext = {
  path: string[];
};

const BUILTIN_TYPES = new Set([
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

const TYPED_ARRAYS = new Set([
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

const isBuiltinType = (cls: any): boolean => {
  if (!cls) return true;
  if (BUILTIN_TYPES.has(cls)) return true;
  if (TYPED_ARRAYS.has(cls)) return true;
  return false;
};

const isPlainObject = (obj: any): boolean => {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
};

/**
 * Get typed-struct field names from a struct class
 */
const getTypedStructFields = (structCls: AnyStructConstructor): Set<string> => {
  const offsets = structCls.getOffsets();
  return new Set(Object.keys(offsets));
};

/**
 * Check if a class is or extends a typed-struct class
 */
const getTypedStructInfo = (cls: AnyClass): { structCls: AnyStructConstructor; fields: Set<string> } | null => {
  const structCls = findTypedStructClass(cls);
  if (!structCls) return null;
  const fields = getTypedStructFields(structCls);
  return { structCls, fields };
};

/**
 * Encode value for transport
 */
export const encodeValue = async (
  value: any,
  transporterInfo: TransporterInfo | null,
  designType: any,
  context: TransportContext = { path: [] },
): Promise<any> => {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle custom encoder
  if (transporterInfo?.type === 'encoder') {
    return await transporterInfo.encoder.encode(value);
  }

  // Get target class from transporter or design type
  let targetClass: AnyClass | null = null;
  let isArray = false;

  if (transporterInfo?.type === 'class') {
    const result = transporterInfo.factory();
    if (Array.isArray(result)) {
      isArray = true;
      targetClass = result[0];
    } else {
      targetClass = result;
    }
  } else if (designType && designType !== Object) {
    targetClass = designType;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (isArray && targetClass) {
      return await Promise.all(
        value.map((item, idx) =>
          encodeValue(item, { type: 'class', factory: () => targetClass! }, targetClass, {
            path: [...context.path, `[${idx}]`],
          }),
        ),
      );
    }
    return await Promise.all(
      value.map((item, idx) =>
        encodeValue(item, null, null, { path: [...context.path, `[${idx}]`] }),
      ),
    );
  }

  // Handle Buffer
  if (Buffer.isBuffer(value)) {
    return {
      __type: 'Buffer',
      data: new Uint8Array(value),
    };
  }

  // Handle builtin types
  if (!targetClass || isBuiltinType(targetClass)) {
    return value;
  }

  // Handle custom class
  if (typeof value === 'object') {
    // Check if it's a typed-struct class
    const structInfo = getTypedStructInfo(targetClass);
    
    if (structInfo) {
      // Handle typed-struct class
      const encoded: any = {
        __type: 'TypedStructClass',
        __className: targetClass.name,
        structBuffer: null,
        data: {},
      };

      // Dump the struct buffer using the static raw method
      const buffer = structInfo.structCls.raw(value) as Buffer;
      encoded.structBuffer = new Uint8Array(buffer);

      // Encode non-struct fields
      const proto = targetClass.prototype;
      for (const key of Object.keys(value)) {
        if (structInfo.fields.has(key)) continue; // Skip struct fields
        
        const propTransporter = getPropertyTransporter(proto, key);
        const propDesignType = Reflect.getMetadata?.('design:type', proto, key);
        
        encoded.data[key] = await encodeValue(
          value[key],
          propTransporter,
          propDesignType,
          { path: [...context.path, key] },
        );
      }

      return encoded;
    }

    // Handle regular custom class
    const encoded: any = {
      __type: 'CustomClass',
      __className: targetClass.name,
      data: {},
    };

    const proto = targetClass.prototype;
    for (const key of Object.keys(value)) {
      const propTransporter = getPropertyTransporter(proto, key);
      const propDesignType = Reflect.getMetadata?.('design:type', proto, key);
      
      encoded.data[key] = await encodeValue(
        value[key],
        propTransporter,
        propDesignType,
        { path: [...context.path, key] },
      );
    }

    return encoded;
  }

  return value;
};

/**
 * Decode value from transport
 */
export const decodeValue = async (
  encoded: any,
  transporterInfo: TransporterInfo | null,
  designType: any,
  context: TransportContext = { path: [] },
): Promise<any> => {
  if (encoded === null || encoded === undefined) {
    return encoded;
  }

  // Handle custom decoder
  if (transporterInfo?.type === 'encoder') {
    return await transporterInfo.encoder.decode(encoded);
  }

  // Get target class from transporter or design type
  let targetClass: AnyClass | null = null;
  let isArray = false;

  if (transporterInfo?.type === 'class') {
    const result = transporterInfo.factory();
    if (Array.isArray(result)) {
      isArray = true;
      targetClass = result[0];
    } else {
      targetClass = result;
    }
  } else if (designType && designType !== Object) {
    targetClass = designType;
  }

  // Handle arrays
  if (Array.isArray(encoded)) {
    if (isArray && targetClass) {
      return await Promise.all(
        encoded.map((item, idx) =>
          decodeValue(item, { type: 'class', factory: () => targetClass! }, targetClass, {
            path: [...context.path, `[${idx}]`],
          }),
        ),
      );
    }
    return await Promise.all(
      encoded.map((item, idx) =>
        decodeValue(item, null, null, { path: [...context.path, `[${idx}]`] }),
      ),
    );
  }

  // Handle special encoded types
  if (typeof encoded === 'object' && encoded.__type) {
    if (encoded.__type === 'Buffer') {
      return Buffer.from(encoded.data as Uint8Array);
    }

    if (encoded.__type === 'TypedStructClass' && targetClass) {
      const structInfo = getTypedStructInfo(targetClass);
      if (!structInfo) {
        throw new Error(`${context.path.join('.')}: Class is marked as TypedStructClass but is not a typed-struct class`);
      }

      // Create instance with struct buffer
      const buffer = encoded.structBuffer ? Buffer.from(encoded.structBuffer) : undefined;
      const instance = new (targetClass as any)(buffer);

      // Decode and set non-struct fields
      const proto = targetClass.prototype;
      for (const key of Object.keys(encoded.data)) {
        const propTransporter = getPropertyTransporter(proto, key);
        const propDesignType = Reflect.getMetadata?.('design:type', proto, key);

        instance[key] = await decodeValue(
          encoded.data[key],
          propTransporter,
          propDesignType,
          { path: [...context.path, key] },
        );
      }

      return instance;
    }

    if (encoded.__type === 'CustomClass' && targetClass) {
      const instance = Object.create(targetClass.prototype);
      const proto = targetClass.prototype;

      for (const key of Object.keys(encoded.data)) {
        const propTransporter = getPropertyTransporter(proto, key);
        const propDesignType = Reflect.getMetadata?.('design:type', proto, key);

        instance[key] = await decodeValue(
          encoded.data[key],
          propTransporter,
          propDesignType,
          { path: [...context.path, key] },
        );
      }

      return instance;
    }
  }

  return encoded;
};

/**
 * Encode method arguments
 */
export const encodeMethodArgs = async (
  target: any,
  methodName: string,
  args: unknown[],
): Promise<unknown[]> => {
  const paramTransporters = getParamTransporters(target, methodName);
  const designParamTypes: any[] = Reflect.getMetadata?.('design:paramtypes', target, methodName) || [];

  return await Promise.all(
    args.map((arg, index) => {
      const transporter = paramTransporters.get(index) || null;
      const designType = designParamTypes[index];
      return encodeValue(arg, transporter, designType, { path: [`arg[${index}]`] });
    }),
  );
};

/**
 * Decode method arguments
 */
export const decodeMethodArgs = async (
  target: any,
  methodName: string,
  encoded: unknown[],
): Promise<unknown[]> => {
  const paramTransporters = getParamTransporters(target, methodName);
  const designParamTypes: any[] = Reflect.getMetadata?.('design:paramtypes', target, methodName) || [];

  return await Promise.all(
    encoded.map((arg, index) => {
      const transporter = paramTransporters.get(index) || null;
      const designType = designParamTypes[index];
      return decodeValue(arg, transporter, designType, { path: [`arg[${index}]`] });
    }),
  );
};

/**
 * Encode method return value
 */
export const encodeMethodReturn = async (
  target: any,
  methodName: string,
  value: unknown,
): Promise<unknown> => {
  const transporter = getReturnTransporter(target, methodName);
  const designReturnType = Reflect.getMetadata?.('design:returntype', target, methodName);

  return await encodeValue(value, transporter, designReturnType, { path: ['return'] });
};

/**
 * Decode method return value
 */
export const decodeMethodReturn = async (
  target: any,
  methodName: string,
  encoded: unknown,
): Promise<unknown> => {
  const transporter = getReturnTransporter(target, methodName);
  const designReturnType = Reflect.getMetadata?.('design:returntype', target, methodName);

  return await decodeValue(encoded, transporter, designReturnType, { path: ['return'] });
};
