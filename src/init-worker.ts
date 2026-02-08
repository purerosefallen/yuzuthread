import { AnyClass } from 'nfkit';
import { Worker } from 'node:worker_threads';
import { getWorkerMethods } from './worker-method';
import {
  getWorkerRegistration,
  WorkerDataPayload,
  WorkerHostMessage,
  WorkerInvokeMessage,
  WorkerResultMessage,
} from './worker';
import { findTypedStructClass } from './utility/find-typed-struct-cls';
import { mutateTypedStructProto } from './utility/mutate-typed-struct-proto';
import { AnyStructConstructor } from './utility/types';

type ErrorLike = {
  message: string;
  name?: string;
  stack?: string;
};

const toError = (error: ErrorLike | unknown, fallback: string): Error => {
  if (error && typeof error === 'object' && 'message' in error) {
    const value = error as ErrorLike;
    const err = new Error(value.message || fallback);
    if (value.name) err.name = value.name;
    if (value.stack) err.stack = value.stack;
    return err;
  }
  return new Error(fallback);
};

const getTypedStructByteLength = (
  structCls: AnyStructConstructor,
  ctorArgs: unknown[],
): { byteLength: number; initial: Uint8Array | null } => {
  const baseSize = structCls.baseSize;
  const firstArg = ctorArgs[0];

  if (Buffer.isBuffer(firstArg)) {
    if (firstArg.length < baseSize) throw new TypeError('Invalid typed-struct buffer size');
    return { byteLength: firstArg.length, initial: firstArg };
  }
  if (Array.isArray(firstArg)) {
    if (firstArg.length < baseSize) throw new TypeError('Invalid typed-struct array size');
    return { byteLength: firstArg.length, initial: Uint8Array.from(firstArg) };
  }
  if (ArrayBuffer.isView(firstArg)) {
    const view = firstArg as ArrayBufferView;
    if (view.byteLength < baseSize) throw new TypeError('Invalid typed-struct view size');
    return {
      byteLength: view.byteLength,
      initial: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    };
  }
  if (firstArg instanceof ArrayBuffer || firstArg instanceof SharedArrayBuffer) {
    if (firstArg.byteLength < baseSize) throw new TypeError('Invalid typed-struct buffer size');
    return { byteLength: firstArg.byteLength, initial: new Uint8Array(firstArg) };
  }
  if (typeof firstArg === 'number') {
    if (firstArg < baseSize) throw new TypeError('Invalid typed-struct buffer size');
    return { byteLength: firstArg, initial: null };
  }
  return { byteLength: baseSize, initial: null };
};

const createOneShotArgsFactory = (
  nextArgs: unknown[],
): (() => unknown[] | undefined) => {
  let used = false;
  return () => {
    if (used) return undefined;
    used = true;
    return nextArgs;
  };
};

const WORKER_BOOTSTRAP = `
const { workerData } = require('node:worker_threads');
if (workerData.__tsRegisterPath) {
  require(workerData.__tsRegisterPath);
}
require(workerData.__entryFile);
`;

const getTsRegisterPath = (filePath: string): string | null => {
  if (!filePath.endsWith('.ts')) return null;
  try {
    return require.resolve('esbuild-register/dist/node');
  } catch {
    return null;
  }
};

export const initWorker = async <C extends AnyClass>(
  cls: C,
  ...args: ConstructorParameters<C>
): Promise<InstanceType<C> & { finalize: () => Promise<void> }> => {
  const registration = getWorkerRegistration(cls);
  if (!registration) {
    throw new Error(`@Worker() is required for ${cls.name || 'AnonymousClass'}`);
  }

  const workerMethods = getWorkerMethods(cls.prototype);
  const localArgs = [...args] as unknown[];
  let typedStructPayload: WorkerDataPayload['typedStruct'] = null;
  const structCls = findTypedStructClass(cls);

  if (structCls) {
    const { byteLength, initial } = getTypedStructByteLength(
      structCls as unknown as AnyStructConstructor,
      localArgs,
    );
    const sharedMemory = new SharedArrayBuffer(byteLength);
    const sharedBuffer = Buffer.from(sharedMemory);
    if (initial) Buffer.from(initial).copy(sharedBuffer);
    const oneShot = createOneShotArgsFactory([sharedBuffer, false]);
    const mutated = mutateTypedStructProto(cls, oneShot);
    if (!mutated) {
      localArgs.splice(0, localArgs.length, sharedBuffer, false);
      typedStructPayload = { mode: 'ctor', sharedBuffer: sharedMemory };
    } else {
      typedStructPayload = { mode: 'mutate', sharedBuffer: sharedMemory };
    }
  }

  const instance = new cls(...(localArgs as ConstructorParameters<C>));
  const workerData: WorkerDataPayload & {
    __entryFile: string;
    __tsRegisterPath: string | null;
  } = {
    __yuzuthread: true,
    classId: registration.id,
    ctorArgs: args as unknown[],
    typedStruct: typedStructPayload,
    __entryFile: registration.filePath,
    __tsRegisterPath: getTsRegisterPath(registration.filePath),
  };
  const worker = new Worker(WORKER_BOOTSTRAP, {
    eval: true,
    workerData,
  });

  let finalized = false;
  let ready = false;
  let nextCallId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >();

  const rejectAll = (error: Error): void => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((item) => item.reject(error));
  };

  let resolveReady!: () => void;
  let rejectReady!: (reason?: unknown) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  worker.on('message', (message: WorkerHostMessage) => {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'ready':
        ready = true;
        resolveReady();
        return;
      case 'init-error': {
        const error = toError(message.error, 'Failed to initialize worker');
        rejectReady(error);
        rejectAll(error);
        return;
      }
      case 'result': {
        const callback = pending.get(message.id);
        if (!callback) return;
        pending.delete(message.id);
        if (message.ok) callback.resolve(message.result);
        else {
          const failed = message as Extract<WorkerResultMessage, { ok: false }>;
          callback.reject(toError(failed.error, 'Worker method execution failed'));
        }
        return;
      }
      case 'finalized':
      default:
        return;
    }
  });

  worker.on('error', (error) => {
    const err = toError(error, 'Worker error');
    if (!ready) rejectReady(err);
    rejectAll(err);
  });

  worker.on('exit', (code) => {
    if (!ready && !finalized) {
      rejectReady(new Error(`Worker exited before ready (code: ${code})`));
    }
    if (!finalized) {
      rejectAll(new Error(`Worker exited (code: ${code})`));
    }
  });

  const callWorkerMethod = (name: string, methodArgs: unknown[]): Promise<unknown> => {
    if (finalized) return Promise.reject(new Error('Worker has been finalized'));
    return readyPromise.then(
      () =>
        new Promise((resolve, reject) => {
          const id = nextCallId;
          nextCallId += 1;
          pending.set(id, { resolve, reject });
          const message: WorkerInvokeMessage = {
            type: 'invoke',
            id,
            method: name,
            args: methodArgs,
          };
          try {
            worker.postMessage(message);
          } catch (error) {
            pending.delete(id);
            reject(toError(error, 'Failed to send message to worker'));
          }
        }),
    );
  };

  workerMethods.forEach((method) => {
    Object.defineProperty(instance, method, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (...methodArgs: unknown[]) => callWorkerMethod(method, methodArgs),
    });
  });

  Object.defineProperty(instance, 'finalize', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: async (): Promise<void> => {
      if (finalized) return;
      finalized = true;
      rejectAll(new Error('Worker has been finalized'));
      try {
        worker.postMessage({ type: 'finalize' } satisfies WorkerInvokeMessage);
      } catch {
        // Worker is already exiting.
      }
      await worker.terminate();
    },
  });

  await readyPromise;
  return instance as InstanceType<C> & { finalize: () => Promise<void> };
};
