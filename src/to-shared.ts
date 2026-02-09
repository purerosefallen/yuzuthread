import { createTypedStructInstance } from './utility/typed-struct-registry';
import { shouldProcessSharedField } from './utility/shared-field-rule';
import {
  BUILTIN_TYPES,
  TYPED_ARRAYS,
  getTypedStructInfo,
} from './utility/type-helpers';

/**
 * Convert an object to use shared memory where possible
 *
 * @param inst The object to convert
 * @param options Optional configuration
 * @param options.useExistingSharedArrayBuffer If provided, typed-struct classes will use this SharedArrayBuffer instead of creating a new one
 * @returns The converted object (modified in-place for user classes)
 *
 * Behavior:
 * - Buffer: Creates a SharedArrayBuffer copy
 * - SharedArrayBuffer: Returns as-is
 * - Built-in types: Returns as-is (not supported)
 * - typed-struct classes: Creates new instance with SharedArrayBuffer, converts non-struct fields by transporter/design:type rules
 * - User classes: Recursively converts fields by transporter/design:type rules in-place (with circular reference protection)
 * - Arrays: Converts each element in-place
 *
 * Field conversion rules:
 * - If @TransportType metadata exists, it is used as the single source of truth
 * - @TransportType encoder mode is not converted (manual encoding)
 * - If no @TransportType metadata exists, design:type is used as fallback
 */
export const toShared = <T>(
  inst: T,
  options?: { useExistingSharedArrayBuffer?: SharedArrayBuffer },
): T => {
  const visited = new WeakSet<object>();

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

      // Use existing SharedArrayBuffer or create a new one
      let sharedBuffer: Buffer;
      if (options?.useExistingSharedArrayBuffer) {
        // Use the provided SharedArrayBuffer
        sharedBuffer = Buffer.from(options.useExistingSharedArrayBuffer);
        // Copy data to the provided buffer
        rawBuffer.copy(sharedBuffer);
      } else {
        // Create a new SharedArrayBuffer and copy data
        const sharedMemory = new SharedArrayBuffer(rawBuffer.length);
        sharedBuffer = Buffer.from(sharedMemory);
        rawBuffer.copy(sharedBuffer);
      }

      // Get constructor parameters if needed
      const args: unknown[] = [];
      // Try to get constructor parameters from the original instance
      // For most typed-struct classes, we can construct with buffer only

      // Create new instance with shared buffer
      // typed-struct cannot replace buffer in-place, must create new instance
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

        if (shouldProcessSharedField(proto, key)) {
          (newInstance as any)[key] = convert(fieldValue);
        } else {
          // No shared conversion needed, copy as-is
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

        if (shouldProcessSharedField(proto, key)) {
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
