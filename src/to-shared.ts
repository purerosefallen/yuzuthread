import { createTypedStructInstance } from './utility/typed-struct-registry';
import { getPropertyTransporter } from './utility/transport-metadata';
import {
  BUILTIN_TYPES,
  TYPED_ARRAYS,
  getTypedStructInfo,
  isBuiltinType,
} from './utility/type-helpers';

/**
 * Convert an object to use shared memory where possible
 * 
 * @param inst The object to convert
 * @returns The converted object (modified in-place for user classes)
 * 
 * Behavior:
 * - Buffer: Creates a SharedArrayBuffer copy
 * - SharedArrayBuffer: Returns as-is
 * - Built-in types: Returns as-is (not supported)
 * - typed-struct classes: Creates new instance with SharedArrayBuffer, converts non-struct fields
 * - User classes: Recursively converts fields in-place (with circular reference protection)
 * - Arrays: Converts each element in-place
 */
export const toShared = <T>(inst: T): T => {
  const visited = new WeakSet<object>();

  /**
   * Check if a transporter should trigger field conversion
   * Returns true only if it's a class type with non-builtin class
   */
  const shouldConvertWithTransporter = (transporter: any): boolean => {
    if (!transporter) return false;
    
    // Encoder type should not trigger conversion (manual encoding)
    if (transporter.type === 'encoder') return false;
    
    // Class type: check if the class is not built-in
    if (transporter.type === 'class') {
      const factoryResult = transporter.factory();
      const targetClass = Array.isArray(factoryResult)
        ? factoryResult[0]
        : factoryResult;
      return !isBuiltinType(targetClass);
    }
    
    return false;
  };

  const convert = (value: any): any => {
    // Handle null and undefined
    if (value === null || value === undefined) {
      return value;
    }

    // Handle primitives
    if (typeof value !== 'object' && typeof value !== 'function') {
      return value;
    }

    // Handle functions
    if (typeof value === 'function') {
      return value;
    }

    // Circular reference detection
    if (visited.has(value)) {
      return value;
    }

    // Handle Buffer
    if (Buffer.isBuffer(value)) {
      // If already backed by SharedArrayBuffer, return as-is
      if (
        value.buffer instanceof SharedArrayBuffer ||
        value.buffer.constructor?.name === 'SharedArrayBuffer'
      ) {
        return value;
      }

      // Create SharedArrayBuffer and copy data
      const sharedBuffer = new SharedArrayBuffer(value.length);
      const shared = Buffer.from(sharedBuffer);
      value.copy(shared);
      return shared;
    }

    // Handle SharedArrayBuffer
    if (
      value instanceof SharedArrayBuffer ||
      value.constructor?.name === 'SharedArrayBuffer'
    ) {
      return value;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      visited.add(value);
      for (let i = 0; i < value.length; i++) {
        value[i] = convert(value[i]);
      }
      return value;
    }

    // Get constructor
    const ctor = value.constructor;

    // Handle built-in types (return as-is, not supported)
    if (BUILTIN_TYPES.has(ctor) || TYPED_ARRAYS.has(ctor)) {
      return value;
    }

    // Check if it's a typed-struct class
    const structInfo = getTypedStructInfo(ctor);
    if (structInfo) {
      visited.add(value);

      // Get the raw buffer
      const rawBuffer = structInfo.structCls.raw(value) as Buffer;

      // Create SharedArrayBuffer and copy data
      const sharedMemory = new SharedArrayBuffer(rawBuffer.length);
      const sharedBuffer = Buffer.from(sharedMemory);
      rawBuffer.copy(sharedBuffer);

      // Get constructor parameters if needed
      const args: unknown[] = [];
      // Try to get constructor parameters from the original instance
      // For most typed-struct classes, we can construct with buffer only
      
      // Create new instance with shared buffer
      const newInstance = createTypedStructInstance(
        ctor,
        sharedBuffer,
        false,
        args,
      );

      // Get typed-struct fields (these are handled by the struct itself)
      const structFields = structInfo.fields;

      // Convert non-struct fields
      const proto = ctor.prototype;
      for (const key of Object.keys(value)) {
        if (structFields.has(key)) {
          // Skip struct fields - they're already handled by the shared buffer
          continue;
        }

        const fieldValue = value[key];
        
        // Check for TransportType metadata or design:type
        const propTransporter = getPropertyTransporter(proto, key);
        const propDesignType =
          Reflect.getMetadata?.('design:type', proto, key);

        // Only convert if there's explicit metadata:
        // 1. TransportType with non-builtin class (not encoder)
        // 2. design:type with non-builtin type
        if (
          shouldConvertWithTransporter(propTransporter) ||
          (propDesignType && !isBuiltinType(propDesignType))
        ) {
          (newInstance as any)[key] = convert(fieldValue);
        } else {
          // No metadata, copy as-is
          (newInstance as any)[key] = fieldValue;
        }
      }

      return newInstance;
    }

    // Handle user classes
    if (ctor && ctor !== Object) {
      visited.add(value);

      const proto = ctor.prototype;

      // Scan all properties
      for (const key of Object.keys(value)) {
        const fieldValue = value[key];
        
        // Check for TransportType metadata or design:type
        const propTransporter = getPropertyTransporter(proto, key);
        const propDesignType =
          Reflect.getMetadata?.('design:type', proto, key);

        // Only convert if there's explicit metadata:
        // 1. TransportType with non-builtin class (not encoder)
        // 2. design:type with non-builtin type
        if (
          shouldConvertWithTransporter(propTransporter) ||
          (propDesignType && !isBuiltinType(propDesignType))
        ) {
          value[key] = convert(fieldValue);
        }
        // Otherwise, leave the field as-is
      }

      return value;
    }

    // Plain objects
    visited.add(value);
    for (const key of Object.keys(value)) {
      value[key] = convert(value[key]);
    }

    return value;
  };

  return convert(inst);
};
