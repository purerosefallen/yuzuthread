import { AnyClass } from 'nfkit';
import { MetadataSetter, Reflector } from 'typed-reflector';
import { getTypedStructInfo, isBuiltinType } from './type-helpers';

/**
 * Factory function for Shared decorator type
 */
export type SharedTypeFactory = () => AnyClass;

/**
 * Metadata for a shared parameter
 */
export interface SharedParamInfo {
  index: number;
  factory?: SharedTypeFactory;
}

/**
 * Metadata map for shared parameters
 */
export interface SharedMetadataMap {}

export interface SharedMetadataArrayMap {
  sharedParams: SharedParamInfo;
}

export const SharedMetadata = new MetadataSetter<
  SharedMetadataMap,
  SharedMetadataArrayMap
>();

export const sharedReflector = new Reflector<
  SharedMetadataMap,
  SharedMetadataArrayMap
>();

/**
 * Check if a type contains any shared memory segments
 * (typed-struct, Buffer, SharedArrayBuffer, or nested user classes with these)
 */
export const hasSharedMemorySegments = (
  cls: AnyClass,
  visited = new WeakSet<AnyClass>(),
): boolean => {
  // Prevent infinite recursion
  if (visited.has(cls)) {
    return false;
  }
  visited.add(cls);

  // Check if it's a typed-struct
  if (getTypedStructInfo(cls)) {
    return true;
  }

  // Check if it's Buffer or SharedArrayBuffer
  if (cls === Buffer || cls === SharedArrayBuffer) {
    return true;
  }

  // Check if it's a built-in type (no shared memory)
  if (isBuiltinType(cls)) {
    return false;
  }

  // For user classes, check all fields with TransportType or design:type metadata
  const proto = cls.prototype;
  if (!proto) {
    return false;
  }

  // Get all metadata keys to find properties with decorators
  const { transportReflector } = require('./transport-metadata');
  
  // Get all property keys that have TransportType decorator
  const transporterKeys = transportReflector.getArray('transporterKeys', proto);
  const allKeys = new Set<string | symbol>(transporterKeys);

  for (const key of allKeys) {
    // Skip constructor and symbols
    if (key === 'constructor' || typeof key === 'symbol') {
      continue;
    }

    // Check design:type metadata
    const designType = Reflect.getMetadata?.('design:type', proto, key);
    
    // Check if design:type is Buffer or SharedArrayBuffer
    if (designType === Buffer || designType === SharedArrayBuffer) {
      return true;
    }
    
    if (designType && !isBuiltinType(designType)) {
      // Recursively check the property type
      if (hasSharedMemorySegments(designType, visited)) {
        return true;
      }
    }

    // Check TransportType metadata
    const transporterData = transportReflector.get('transporter', proto, key as string);
    if (transporterData && transporterData.kind === 'property') {
      const info = transporterData.info;
      if (info.type === 'class') {
        const factoryResult = info.factory();
        const targetClass = Array.isArray(factoryResult)
          ? factoryResult[0]
          : factoryResult;
        
        // Check if it's Buffer or SharedArrayBuffer
        if (targetClass === Buffer || targetClass === SharedArrayBuffer) {
          return true;
        }
        
        if (hasSharedMemorySegments(targetClass, visited)) {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Mark a constructor parameter as shared memory
 * The parameter must contain shared memory segments (typed-struct, Buffer, SharedArrayBuffer, or nested classes with these)
 *
 * @param factory Optional factory function that returns the class type
 */
export const Shared = (
  factory?: SharedTypeFactory,
): ParameterDecorator => {
  return ((
    target: any,
    propertyKey: string | symbol | undefined,
    parameterIndex: number,
  ) => {
    // Validate that it's a constructor parameter
    if (propertyKey !== undefined) {
      throw new TypeError(
        '@Shared can only be used on constructor parameters',
      );
    }

    // Get the parameter type from design:paramtypes
    const paramTypes = Reflect.getMetadata?.('design:paramtypes', target) || [];
    const paramType = paramTypes[parameterIndex];

    // Determine the actual type
    const actualType = factory ? factory() : paramType;

    if (!actualType) {
      throw new TypeError(
        `@Shared parameter at index ${parameterIndex} has no type information. ` +
          'Either provide a factory function or enable emitDecoratorMetadata.',
      );
    }

    // Check if the type has shared memory segments
    if (!hasSharedMemorySegments(actualType)) {
      throw new TypeError(
        `@Shared parameter at index ${parameterIndex} (type: ${actualType.name}) ` +
          'does not contain any shared memory segments (typed-struct, Buffer, SharedArrayBuffer, or nested classes with these). ' +
          '@Shared can only be used on parameters that support shared memory.',
      );
    }

    // Store metadata - retrieve existing array and append
    const existing = sharedReflector.getArray('sharedParams', target);
    const newArray = [...existing, { index: parameterIndex, factory }];
    
    // Use MetadataSetter to set the array
    Reflect.defineMetadata?.('sharedParams', newArray, target);
  }) as ParameterDecorator;
};

/**
 * Get all shared parameters for a class constructor
 */
export const getSharedParams = (
  target: AnyClass,
): Map<number, SharedParamInfo> => {
  const params = sharedReflector.getArray('sharedParams', target);
  const map = new Map<number, SharedParamInfo>();
  
  for (const param of params) {
    map.set(param.index, param);
  }
  
  return map;
};

/**
 * Calculate the total shared memory size needed for an object
 * 
 * @param obj The object to calculate size for
 * @param visited Set of already visited objects to prevent circular references
 * @returns The total size in bytes
 */
export const calculateSharedMemorySize = (
  obj: any,
  visited = new WeakSet<object>(),
): number => {
  // Handle null and undefined
  if (obj === null || obj === undefined) {
    return 0;
  }

  // Handle primitives
  if (typeof obj !== 'object' && typeof obj !== 'function') {
    return 0;
  }

  // Handle functions
  if (typeof obj === 'function') {
    return 0;
  }

  // Circular reference detection
  if (visited.has(obj)) {
    return 0;
  }
  visited.add(obj);

  // Handle Buffer
  if (Buffer.isBuffer(obj)) {
    // Check if already backed by SharedArrayBuffer
    if (
      obj.buffer instanceof SharedArrayBuffer ||
      obj.buffer.constructor?.name === 'SharedArrayBuffer'
    ) {
      return 0; // Already shared
    }
    return obj.length;
  }

  // Handle SharedArrayBuffer
  if (
    obj instanceof SharedArrayBuffer ||
    obj.constructor?.name === 'SharedArrayBuffer'
  ) {
    return 0; // Already shared
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    let total = 0;
    for (const item of obj) {
      total += calculateSharedMemorySize(item, visited);
    }
    return total;
  }

  // Get constructor
  const ctor = obj.constructor;

  // Handle built-in types
  if (isBuiltinType(ctor)) {
    return 0;
  }

  // Check if it's a typed-struct class
  const structInfo = getTypedStructInfo(ctor);
  if (structInfo) {
    const rawBuffer = structInfo.structCls.raw(obj) as Buffer;
    
    // Check if already backed by SharedArrayBuffer
    if (
      rawBuffer.buffer instanceof SharedArrayBuffer ||
      rawBuffer.buffer.constructor?.name === 'SharedArrayBuffer'
    ) {
      return 0; // Already shared
    }

    let total = rawBuffer.length;

    // Add sizes of non-struct fields
    const proto = ctor.prototype;
    for (const key of Object.keys(obj)) {
      if (structInfo.fields.has(key)) {
        continue; // Skip struct fields
      }

      const fieldValue = obj[key];
      
      // Check for TransportType metadata or design:type
      const { getPropertyTransporter } = require('./transport-metadata');
      const propTransporter = getPropertyTransporter(proto, key);
      const propDesignType = Reflect.getMetadata?.('design:type', proto, key);

      // Only calculate if there's explicit metadata
      if (
        propTransporter?.type === 'class' ||
        (propDesignType && !isBuiltinType(propDesignType))
      ) {
        total += calculateSharedMemorySize(fieldValue, visited);
      }
    }

    return total;
  }

  // Handle user classes
  if (ctor && ctor !== Object) {
    let total = 0;
    const proto = ctor.prototype;

    for (const key of Object.keys(obj)) {
      const fieldValue = obj[key];
      
      // Check for TransportType metadata or design:type
      const { getPropertyTransporter } = require('./transport-metadata');
      const propTransporter = getPropertyTransporter(proto, key);
      const propDesignType = Reflect.getMetadata?.('design:type', proto, key);

      // Only calculate if there's explicit metadata
      if (
        propTransporter?.type === 'class' ||
        (propDesignType && !isBuiltinType(propDesignType))
      ) {
        total += calculateSharedMemorySize(fieldValue, visited);
      }
    }

    return total;
  }

  // Plain objects
  let total = 0;
  for (const key of Object.keys(obj)) {
    total += calculateSharedMemorySize(obj[key], visited);
  }

  return total;
};
