import { AnyClass, ClassType } from 'nfkit';
import { findTypedStructClass } from './find-typed-struct-cls';
import { mutateTypedStructProto } from './mutate-typed-struct-proto';
import { AnyStructConstructor } from './types';

/**
 * Mutable callback state for bridge interception
 */
interface CallbackState {
  fn: () => unknown[] | undefined;
}

/**
 * Information about a typed-struct class after scanning
 */
interface TypedStructInfo {
  /**
   * Whether this class is directly a typed-struct base class (no mutation needed)
   */
  isBaseClass: boolean;

  /**
   * The typed-struct base class
   */
  baseClass: AnyStructConstructor | null;

  /**
   * Size of the struct buffer (baseSize)
   */
  bufferSize: number | null;

  /**
   * Whether mutation was successfully applied
   */
  mutated: boolean;

  /**
   * Mutable callback state (bridgeState.cb references this)
   */
  callback: CallbackState | null;
}

/**
 * WeakMap to store typed-struct class scan results
 */
const typedStructRegistry = new WeakMap<ClassType<any>, TypedStructInfo>();

/**
 * Scan and prepare a typed-struct class for instantiation
 *
 * This method:
 * 1. Finds the typed-struct base class
 * 2. Applies mutation if needed (unless it's already the base class)
 * 3. Stores the result in WeakMap
 * 4. Skips if already scanned
 *
 * @param cls The class to scan
 */
export const scanTypedStructClass = (cls: ClassType<any>): void => {
  // Skip if already scanned
  if (typedStructRegistry.has(cls)) {
    return;
  }

  const baseClass = findTypedStructClass(cls);

  // If not a typed-struct class, mark as such and return
  if (!baseClass) {
    typedStructRegistry.set(cls, {
      isBaseClass: false,
      baseClass: null,
      bufferSize: null,
      mutated: false,
      callback: null,
    });
    return;
  }

  const bufferSize = (baseClass as any).baseSize ?? null;

  // Check if this class can be constructed directly with (buffer, clone) arguments
  // This is true if cls is the base class or a direct child without custom constructor
  const isBaseClass = cls === baseClass;

  // Check if cls has a custom constructor by comparing constructor functions
  const clsConstructor = cls.prototype.constructor;
  const baseConstructor = baseClass.prototype.constructor;
  const hasCustomConstructor = clsConstructor !== baseConstructor;

  const canConstructDirectly = isBaseClass || !hasCustomConstructor;

  // If it can be constructed directly, no mutation needed
  if (canConstructDirectly) {
    typedStructRegistry.set(cls, {
      isBaseClass: true, // Treat as base class for construction purposes
      baseClass,
      bufferSize,
      mutated: false,
      callback: null,
    });
    return;
  }

  // For derived classes, apply mutation
  // Create a mutable state object that bridgeState.cb will reference
  const callbackState = {
    fn: (() => undefined) as () => unknown[] | undefined,
  };
  const mutated = mutateTypedStructProto(cls, () => callbackState.fn());

  typedStructRegistry.set(cls, {
    isBaseClass: false,
    baseClass,
    bufferSize,
    mutated,
    callback: mutated ? callbackState : null,
  });
};

/**
 * Get typed-struct class information
 *
 * If the class hasn't been scanned yet, triggers a scan.
 *
 * @param cls The class to get info for
 * @returns The typed-struct info, or null if not a typed-struct class
 */
export const getTypedStructInfo = (
  cls: ClassType<any>,
): TypedStructInfo | null => {
  if (!typedStructRegistry.has(cls)) {
    scanTypedStructClass(cls);
  }

  const info = typedStructRegistry.get(cls);
  if (!info || !info.baseClass) {
    return null;
  }

  return info;
};

/**
 * Create a typed-struct instance with a given buffer
 *
 * This method handles both:
 * - Base typed-struct classes or classes without custom constructors (direct construction)
 * - Derived classes with custom constructors (mutation-based)
 *
 * @param cls The typed-struct class constructor
 * @param buffer The buffer to use for the struct
 * @param clone Whether to clone the buffer (default: false for SharedArrayBuffer sharing)
 * @param args Additional constructor arguments (for classes with custom constructors)
 * @returns A new instance of the class
 */
export const createTypedStructInstance = <C extends AnyClass>(
  cls: C,
  buffer: Buffer,
  clone: boolean = false,
  args: ConstructorParameters<C> = [] as ConstructorParameters<C>,
): InstanceType<C> => {
  const info = getTypedStructInfo(cls);

  if (!info) {
    throw new TypeError(
      `Cannot create instance: ${cls.name} is not a typed-struct class`,
    );
  }

  // If it's the base class or has no custom constructor, construct directly with buffer
  if (info.isBaseClass) {
    return new (cls as any)(buffer, clone) as InstanceType<C>;
  }

  // If mutation was applied, use the callback mechanism
  if (info.mutated && info.callback) {
    let executed = false;
    const originalFn = info.callback.fn;

    // Temporarily override the callback function to provide buffer arguments
    info.callback.fn = () => {
      if (executed) return undefined;
      executed = true;
      return [buffer, clone];
    };

    try {
      // Construct with provided arguments - mutation will intercept super() and provide buffer
      const instance = new (cls as any)(...args) as InstanceType<C>;
      return instance;
    } finally {
      // Restore original callback (always returns undefined)
      info.callback.fn = originalFn;
    }
  }

  // Fallback: construct directly (shouldn't normally reach here)
  return new (cls as any)(buffer, clone) as InstanceType<C>;
};

/**
 * Safely scan a class that might not be defined yet
 *
 * Used in decorators where the class might be used before it's fully defined.
 * Errors are silently ignored.
 *
 * @param cls The class to scan (or factory that returns the class)
 */
export const safeScanTypedStructClass = (cls: any): void => {
  try {
    if (typeof cls === 'function') {
      scanTypedStructClass(cls);
    }
  } catch {
    // Ignore errors for classes that aren't defined yet
  }
};
