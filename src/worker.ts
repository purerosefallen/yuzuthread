import { AnyClass } from 'nfkit';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { getWorkerCallbacks, getWorkerMethods } from './worker-method';
import { findTypedStructClass } from './utility/find-typed-struct-cls';
import { AnyStructConstructor } from './utility/types';
import {
  encodeMethodArgs,
  decodeMethodReturn,
  encodeMethodReturn,
  decodeMethodArgs,
} from './utility/transport';
import {
  createTypedStructInstance,
  safeScanTypedStructClass,
} from './utility/typed-struct-registry';

type SerializedError = {
  message: string;
  name?: string;
  stack?: string;
};

export type WorkerInvokeMessage =
  | {
      type: 'invoke';
      id: number;
      method: string;
      args: unknown[];
    }
  | WorkerCallbackResultMessage
  | {
      type: 'finalize';
    };

export type WorkerResultMessage =
  | {
      type: 'result';
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      type: 'result';
      id: number;
      ok: false;
      error: SerializedError;
    };

export type WorkerHostMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'init-error';
      error: SerializedError;
    }
  | {
      type: 'finalized';
    }
  | WorkerCallbackInvokeMessage
  | WorkerResultMessage;

export type WorkerCallbackInvokeMessage = {
  type: 'callback-invoke';
  id: number;
  method: string;
  args: unknown[];
};

export type WorkerCallbackResultMessage =
  | {
      type: 'callback-result';
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      type: 'callback-result';
      id: number;
      ok: false;
      error: SerializedError;
    };

export type WorkerDataPayload = {
  __yuzuthread: true;
  classId: string;
  ctorArgs: unknown[];
  typedStruct: {
    sharedBuffer: SharedArrayBuffer;
  } | null;
};

export type WorkerTypedStructRegistration = {
  structCls: AnyStructConstructor;
  baseSize: number;
  mode: 'mutate' | 'ctor';
  resolveBufferInfo: (ctorArgs: unknown[]) => {
    byteLength: number;
    initial: Uint8Array | null;
  };
  setOneShotArgs: (args: unknown[] | undefined) => void;
};

export type WorkerRegistration = {
  id: string;
  filePath: string;
  typedStruct: WorkerTypedStructRegistration | null;
};

const REGISTRY = new WeakMap<AnyClass, WorkerRegistration>();
const STARTED = new Set<string>();

type WorkerOptions = {
  filePath?: string;
  id?: string;
};

const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }
  return { message: String(error) };
};

const callsites = (): NodeJS.CallSite[] => {
  const errorCtr = Error as ErrorConstructor & {
    prepareStackTrace?: (error: Error, stack: NodeJS.CallSite[]) => unknown;
  };
  const oldPrepareStackTrace = errorCtr.prepareStackTrace;
  errorCtr.prepareStackTrace = (_, stack) => stack;
  const stack = (new Error().stack as unknown as NodeJS.CallSite[]).slice(1);
  errorCtr.prepareStackTrace = oldPrepareStackTrace;
  return stack;
};

const getCurrentFile = (index = 2): string | null => {
  const fileName = callsites()[index]?.getFileName();
  if (!fileName) return null;
  try {
    return fileURLToPath(fileName);
  } catch {
    return fileName;
  }
};

const getTypedStructBufferInfo = (
  baseSize: number,
  ctorArgs: unknown[],
): { byteLength: number; initial: Uint8Array | null } => {
  const firstArg = ctorArgs[0];
  if (Buffer.isBuffer(firstArg)) {
    if (firstArg.length < baseSize)
      throw new TypeError('Invalid typed-struct buffer size');
    return { byteLength: firstArg.length, initial: firstArg };
  }
  if (Array.isArray(firstArg)) {
    if (firstArg.length < baseSize)
      throw new TypeError('Invalid typed-struct array size');
    return { byteLength: firstArg.length, initial: Uint8Array.from(firstArg) };
  }
  if (ArrayBuffer.isView(firstArg)) {
    const view = firstArg as ArrayBufferView;
    if (view.byteLength < baseSize)
      throw new TypeError('Invalid typed-struct view size');
    return {
      byteLength: view.byteLength,
      initial: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    };
  }
  if (
    firstArg instanceof ArrayBuffer ||
    firstArg instanceof SharedArrayBuffer
  ) {
    if (firstArg.byteLength < baseSize)
      throw new TypeError('Invalid typed-struct buffer size');
    return {
      byteLength: firstArg.byteLength,
      initial: new Uint8Array(firstArg),
    };
  }
  if (typeof firstArg === 'number') {
    if (firstArg < baseSize)
      throw new TypeError('Invalid typed-struct buffer size');
    return { byteLength: firstArg, initial: null };
  }
  return { byteLength: baseSize, initial: null };
};

const createTypedStructRegistration = (
  cls: AnyClass,
): WorkerTypedStructRegistration | null => {
  const structCls = findTypedStructClass(cls) as AnyStructConstructor | null;
  if (!structCls) return null;

  const typedStruct: WorkerTypedStructRegistration = {
    structCls,
    baseSize: structCls.baseSize,
    mode: 'ctor', // Mode no longer used, kept for compatibility
    resolveBufferInfo: (ctorArgs: unknown[]) =>
      getTypedStructBufferInfo(structCls.baseSize, ctorArgs),
    setOneShotArgs: () => {}, // No longer needed, kept for compatibility
  };
  return typedStruct;
};

const invokeWorkerMethod = async (
  instance: Record<string, unknown>,
  method: string,
  args: unknown[],
): Promise<unknown> => {
  const target = instance[method];
  if (typeof target !== 'function') {
    throw new TypeError(`Worker method not found: ${method}`);
  }
  return target.apply(instance, args);
};

const setupWorkerRuntime = async (
  cls: AnyClass,
  data: WorkerDataPayload,
  registration: WorkerRegistration,
): Promise<void> => {
  if (!parentPort) throw new Error('Worker parentPort is not available');

  let instance: any;
  if (data.typedStruct && registration.typedStruct) {
    // Use createTypedStructInstance for typed-struct classes
    const sharedBuffer = Buffer.from(data.typedStruct.sharedBuffer);
    instance = createTypedStructInstance(
      cls,
      sharedBuffer,
      false,
      data.ctorArgs,
    );
  } else {
    // Regular class construction
    instance = new cls(...data.ctorArgs);
  }
  const workerMethods = new Set(getWorkerMethods(cls.prototype));
  const workerCallbacks = new Set(getWorkerCallbacks(cls.prototype));
  const pendingCallbacks = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      method: string;
    }
  >();
  let nextCallbackId = 1;

  const callMainCallback = async (
    method: string,
    args: unknown[],
  ): Promise<unknown> => {
    if (!parentPort)
      return Promise.reject(new Error('Worker parentPort is not available'));

    // Encode arguments
    const encodedArgs = await encodeMethodArgs(cls.prototype, method, args);

    return new Promise((resolve, reject) => {
      const id = nextCallbackId;
      nextCallbackId += 1;
      pendingCallbacks.set(id, { resolve, reject, method });
      parentPort.postMessage({
        type: 'callback-invoke',
        id,
        method,
        args: encodedArgs,
      } satisfies WorkerHostMessage);
    });
  };

  workerCallbacks.forEach((method) => {
    Object.defineProperty(instance, method, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (...methodArgs: unknown[]) => callMainCallback(method, methodArgs),
    });
  });

  parentPort.on('message', async (message: WorkerInvokeMessage) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'callback-result') {
      const pending = pendingCallbacks.get(message.id);
      if (!pending) return;
      pendingCallbacks.delete(message.id);
      if (message.ok) {
        // Decode return value
        decodeMethodReturn(cls.prototype, pending.method, message.result)
          .then((decoded) => pending.resolve(decoded))
          .catch((error) => pending.reject(error));
      } else {
        const failed = message as Extract<
          WorkerCallbackResultMessage,
          { ok: false }
        >;
        pending.reject(new Error(failed.error.message));
      }
      return;
    }
    if (message.type === 'finalize') {
      parentPort.postMessage({ type: 'finalized' } satisfies WorkerHostMessage);
      process.exit(0);
      return;
    }
    if (message.type !== 'invoke') return;
    if (!workerMethods.has(message.method)) {
      parentPort.postMessage({
        type: 'result',
        id: message.id,
        ok: false,
        error: {
          message: `Method is not decorated with @WorkerMethod(): ${message.method}`,
        },
      } satisfies WorkerHostMessage);
      return;
    }
    try {
      // Decode arguments
      const decodedArgs = await decodeMethodArgs(
        cls.prototype,
        message.method,
        Array.isArray(message.args) ? message.args : [],
      );

      const result = await invokeWorkerMethod(
        instance as Record<string, unknown>,
        message.method,
        decodedArgs,
      );

      // Encode return value
      const encodedResult = await encodeMethodReturn(
        cls.prototype,
        message.method,
        result,
      );

      parentPort.postMessage({
        type: 'result',
        id: message.id,
        ok: true,
        result: encodedResult,
      } satisfies WorkerHostMessage);
    } catch (error) {
      parentPort.postMessage({
        type: 'result',
        id: message.id,
        ok: false,
        error: serializeError(error),
      } satisfies WorkerHostMessage);
    }
  });

  parentPort.postMessage({ type: 'ready' } satisfies WorkerHostMessage);
};

const tryStartWorkerForClass = (
  target: AnyClass,
  registration: WorkerRegistration,
): void => {
  if (isMainThread || !parentPort) return;
  const data = workerData as WorkerDataPayload | undefined;
  if (!data || data.__yuzuthread !== true) return;
  if (data.classId !== registration.id) return;
  if (STARTED.has(registration.id)) return;
  STARTED.add(registration.id);

  void setupWorkerRuntime(target, data, registration).catch((error) => {
    parentPort.postMessage({
      type: 'init-error',
      error: serializeError(error),
    } satisfies WorkerHostMessage);
  });
};

export const DefineWorker = (options: WorkerOptions = {}): ClassDecorator => {
  const resolvedFilePath = options.filePath ?? getCurrentFile();

  return (target) => {
    const cls = target as unknown as AnyClass;
    const existing = REGISTRY.get(cls);
    if (existing) {
      tryStartWorkerForClass(cls, existing);
      return;
    }
    if (!resolvedFilePath) {
      throw new Error('@DefineWorker() failed: cannot resolve class file path');
    }

    // Scan the worker class itself for typed-struct
    safeScanTypedStructClass(cls);

    // Scan all WorkerMethod parameters and return types
    const methods = getWorkerMethods(cls.prototype);
    for (const methodName of methods) {
      try {
        // Scan return type
        const returnType = Reflect.getMetadata?.(
          'design:returntype',
          cls.prototype,
          methodName,
        );
        if (returnType) {
          safeScanTypedStructClass(returnType);
        }

        // Scan parameter types
        const paramTypes: any[] =
          Reflect.getMetadata?.(
            'design:paramtypes',
            cls.prototype,
            methodName,
          ) || [];
        for (const paramType of paramTypes) {
          safeScanTypedStructClass(paramType);
        }
      } catch {
        // Ignore errors
      }
    }

    const typedStruct = createTypedStructRegistration(cls);
    const registration: WorkerRegistration = {
      id: options.id ?? `${resolvedFilePath}#${cls.name || 'AnonymousClass'}`,
      filePath: resolvedFilePath,
      typedStruct,
    };
    REGISTRY.set(cls, registration);
    tryStartWorkerForClass(cls, registration);
  };
};

export const getWorkerRegistration = <C extends AnyClass>(
  cls: C,
): WorkerRegistration | null => {
  return REGISTRY.get(cls) ?? null;
};
