import { AnyClass } from 'nfkit';
import {
  TransporterInfo,
  getReturnTransporter,
  getParamTransporters,
  getPropertyTransporter,
  transportReflector,
} from './transport-metadata';
import { AnyStructConstructor } from './types';
import { createTypedStructInstance } from './typed-struct-registry';
import {
  BUILTIN_TYPES,
  TYPED_ARRAYS,
  isBuiltinType,
  isPlainObject,
  getTypedStructInfo,
} from './type-helpers';

type TransportContext = {
  path: string[];
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
          encodeValue(
            item,
            { type: 'class', factory: () => targetClass! },
            targetClass,
            {
              path: [...context.path, `[${idx}]`],
            },
          ),
        ),
      );
    }
    return await Promise.all(
      value.map((item, idx) =>
        encodeValue(item, null, null, { path: [...context.path, `[${idx}]`] }),
      ),
    );
  }

  // Handle Buffer -> encode with SharedArrayBuffer support
  if (Buffer.isBuffer(value)) {
    // Check if the buffer is backed by SharedArrayBuffer
    const isSharedBuffer =
      value.buffer instanceof SharedArrayBuffer ||
      value.buffer?.constructor?.name === 'SharedArrayBuffer';

    if (isSharedBuffer) {
      return {
        __type: 'Buffer',
        data: value.buffer, // Pass SharedArrayBuffer directly
        byteOffset: value.byteOffset,
        byteLength: value.byteLength,
        isShared: true,
      };
    } else {
      return {
        __type: 'Buffer',
        data: new Uint8Array(value),
        isShared: false,
      };
    }
  }

  // Handle SharedArrayBuffer -> pass directly
  if (
    value instanceof SharedArrayBuffer ||
    value?.constructor?.name === 'SharedArrayBuffer'
  ) {
    return {
      __type: 'SharedArrayBuffer',
      data: value,
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
        isShared: false,
        data: {},
      };

      // Dump the struct buffer using the static raw method
      const buffer = structInfo.structCls.raw(value) as Buffer;

      // Check if the buffer is backed by SharedArrayBuffer
      if (buffer && buffer.buffer instanceof SharedArrayBuffer) {
        // For SharedArrayBuffer, pass the SharedArrayBuffer directly
        // postMessage will transfer the reference, not copy it
        encoded.structBuffer = buffer.buffer;
        encoded.isShared = true;
        encoded.byteOffset = buffer.byteOffset;
        encoded.byteLength = buffer.byteLength;
        // console.log(`[Encode] SharedArrayBuffer detected for ${targetClass.name}`);
      } else {
        // For regular Buffer, copy to Uint8Array
        encoded.structBuffer = new Uint8Array(buffer);
        encoded.isShared = false;
        // console.log(`[Encode] Regular buffer for ${targetClass.name}`);
      }

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
          decodeValue(
            item,
            { type: 'class', factory: () => targetClass! },
            targetClass,
            {
              path: [...context.path, `[${idx}]`],
            },
          ),
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
      // Check if it's backed by SharedArrayBuffer
      const isSharedBuffer =
        encoded.isShared &&
        (encoded.data instanceof SharedArrayBuffer ||
          encoded.data?.constructor?.name === 'SharedArrayBuffer');

      if (isSharedBuffer) {
        // Create Buffer view from SharedArrayBuffer without copying
        return Buffer.from(
          encoded.data,
          encoded.byteOffset || 0,
          encoded.byteLength || encoded.data.byteLength,
        );
      } else {
        // Regular Buffer
        return Buffer.from(encoded.data as Uint8Array);
      }
    }

    if (encoded.__type === 'SharedArrayBuffer') {
      // Return the SharedArrayBuffer directly
      return encoded.data;
    }

    if (encoded.__type === 'TypedStructClass' && targetClass) {
      const structInfo = getTypedStructInfo(targetClass);
      if (!structInfo) {
        throw new Error(
          `${context.path.join('.')}: Class is marked as TypedStructClass but is not a typed-struct class`,
        );
      }

      // Prepare buffer and clone flag
      let buffer: Buffer | undefined;
      let clone = true; // Default: clone for regular buffers

      if (encoded.structBuffer) {
        // Check for SharedArrayBuffer using multiple methods (instanceof can fail across realms)
        const isSharedBuffer =
          encoded.isShared &&
          (encoded.structBuffer instanceof SharedArrayBuffer ||
            encoded.structBuffer?.constructor?.name === 'SharedArrayBuffer' ||
            Object.prototype.toString.call(encoded.structBuffer) ===
              '[object SharedArrayBuffer]');

        if (isSharedBuffer) {
          // For SharedArrayBuffer, create Buffer view directly
          buffer = Buffer.from(
            encoded.structBuffer,
            encoded.byteOffset || 0,
            encoded.byteLength || encoded.structBuffer.byteLength,
          );
          clone = false; // Don't clone SharedArrayBuffer
        } else {
          // For regular buffer, create new Buffer
          buffer = Buffer.from(encoded.structBuffer);
          clone = true; // Clone regular buffers
        }
      }

      // Use createTypedStructInstance to handle typed-struct instantiation
      const instance = createTypedStructInstance(targetClass, buffer, clone);

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
 * Get transporter info for constructor parameters
 * Constructor parameters are stored with propertyKey = undefined
 */
const getCtorParamTransporters = (cls: AnyClass): Map<number, TransporterInfo> => {
  // Constructor parameter metadata is stored without propertyKey
  const data = transportReflector.get('transporter', cls, undefined as any);
  if (!data) return new Map();
  if (data.kind === 'params') return data.params;
  return new Map();
};

/**
 * Encode constructor arguments
 */
export const encodeCtorArgs = async (
  cls: AnyClass,
  args: unknown[],
): Promise<unknown[]> => {
  const paramTransporters = getCtorParamTransporters(cls);
  const designParamTypes: any[] =
    Reflect.getMetadata?.('design:paramtypes', cls) || [];

  return await Promise.all(
    args.map((arg, index) => {
      const transporter = paramTransporters.get(index) || null;
      const designType = designParamTypes[index];
      return encodeValue(arg, transporter, designType, {
        path: [`ctorArg[${index}]`],
      });
    }),
  );
};

/**
 * Decode constructor arguments
 */
export const decodeCtorArgs = async (
  cls: AnyClass,
  encoded: unknown[],
): Promise<unknown[]> => {
  const paramTransporters = getCtorParamTransporters(cls);
  const designParamTypes: any[] =
    Reflect.getMetadata?.('design:paramtypes', cls) || [];

  return await Promise.all(
    encoded.map((arg, index) => {
      const transporter = paramTransporters.get(index) || null;
      const designType = designParamTypes[index];
      return decodeValue(arg, transporter, designType, {
        path: [`ctorArg[${index}]`],
      });
    }),
  );
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
  const designParamTypes: any[] =
    Reflect.getMetadata?.('design:paramtypes', target, methodName) || [];

  return await Promise.all(
    args.map((arg, index) => {
      const transporter = paramTransporters.get(index) || null;
      const designType = designParamTypes[index];
      return encodeValue(arg, transporter, designType, {
        path: [`arg[${index}]`],
      });
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
  const designParamTypes: any[] =
    Reflect.getMetadata?.('design:paramtypes', target, methodName) || [];

  return await Promise.all(
    encoded.map((arg, index) => {
      const transporter = paramTransporters.get(index) || null;
      const designType = designParamTypes[index];
      return decodeValue(arg, transporter, designType, {
        path: [`arg[${index}]`],
      });
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
  const designReturnType = Reflect.getMetadata?.(
    'design:returntype',
    target,
    methodName,
  );

  return await encodeValue(value, transporter, designReturnType, {
    path: ['return'],
  });
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
  const designReturnType = Reflect.getMetadata?.(
    'design:returntype',
    target,
    methodName,
  );

  return await decodeValue(encoded, transporter, designReturnType, {
    path: ['return'],
  });
};
