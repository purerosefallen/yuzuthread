import { AnyClass } from 'nfkit';
import { Worker } from 'node:worker_threads';
import {
  getWorkerCallbacks,
  getWorkerMethods,
  getWorkerEventHandlers,
} from './worker-method';
import {
  getWorkerRegistration,
  WorkerCallbackInvokeMessage,
  WorkerCallbackResultMessage,
  WorkerDataPayload,
  WorkerHostMessage,
  WorkerInvokeMessage,
  WorkerResultMessage,
} from './worker';
import { WorkerStatus } from './utility/types';
import {
  encodeMethodArgs,
  decodeMethodReturn,
  encodeMethodReturn,
  decodeMethodArgs,
} from './utility/transport';
import { createTypedStructInstance } from './utility/typed-struct-registry';
import { getSharedParams } from './utility/shared-decorator';
import { toShared } from './to-shared';
import { encodeCtorArgs } from './utility/transport';

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

const serializeError = (error: unknown): ErrorLike => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }
  return { message: String(error) };
};

const WORKER_BOOTSTRAP = `
const { workerData } = require('node:worker_threads');
require(workerData.__entryFile);
`;

export type WorkerInstance<T> = T & {
  finalize: () => Promise<void>;
  workerStatus: () => WorkerStatus;
};

export const initWorker = async <C extends AnyClass>(
  cls: C,
  ...args: ConstructorParameters<C>
): Promise<WorkerInstance<InstanceType<C>>> => {
  const registration = getWorkerRegistration(cls);
  if (!registration) {
    throw new Error(
      `@DefineWorker() is required for ${cls.name || 'AnonymousClass'}`,
    );
  }

  const workerMethods = getWorkerMethods(cls.prototype);
  const workerCallbacks = new Set(getWorkerCallbacks(cls.prototype));
  let typedStructPayload: WorkerDataPayload['typedStruct'] = null;
  const typedStruct = registration.typedStruct;

  // Scan for @Shared parameters
  const sharedParams = getSharedParams(cls);
  const processedArgs = [...args];

  // Process @Shared parameters
  if (sharedParams.length > 0) {
    for (const paramInfo of sharedParams) {
      const index = paramInfo.index;

      const arg = args[index];

      // Convert argument to shared memory
      const sharedArg = toShared(arg);

      // Update processed args for worker construction
      processedArgs[index] = sharedArg;
    }
  }

  let instance: InstanceType<C>;
  if (typedStruct) {
    // First, create a temporary instance with processed args to get initial buffer values
    const tempInstance = new cls(
      ...(processedArgs as ConstructorParameters<C>),
    );
    const tempBuffer = typedStruct.structCls.raw(tempInstance) as Buffer;

    // Create SharedArrayBuffer and copy initial values
    const sharedMemory = new SharedArrayBuffer(tempBuffer.length);
    const sharedBuffer = Buffer.from(sharedMemory);
    tempBuffer.copy(sharedBuffer);

    typedStructPayload = { sharedBuffer: sharedMemory };

    // Use createTypedStructInstance with processed args
    instance = createTypedStructInstance(
      cls,
      sharedBuffer,
      false,
      processedArgs as any,
    );
  } else {
    // Regular class construction
    instance = new cls(...(processedArgs as ConstructorParameters<C>));
  }
  const eventHandlers = getWorkerEventHandlers(cls.prototype);

  const callEventHandlers = (event: string, ...eventArgs: unknown[]): void => {
    const handlers = eventHandlers.get(event);
    if (!handlers) return;
    for (const handlerKey of handlers) {
      const handler = (instance as Record<string, unknown>)[handlerKey];
      if (typeof handler === 'function') {
        try {
          handler.apply(instance, eventArgs);
        } catch (error) {
          console.error(
            `Error in @OnWorkerEvent('${event}') handler ${handlerKey}:`,
            error,
          );
        }
      }
    }
  };

  // Encode constructor arguments for worker thread
  // This ensures custom classes don't lose their prototype through structured clone
  const encodedCtorArgs = await encodeCtorArgs(cls, processedArgs);

  const workerData: WorkerDataPayload & {
    __entryFile: string;
  } = {
    __yuzuthread: true,
    classId: registration.id,
    ctorArgs: encodedCtorArgs,
    typedStruct: typedStructPayload,
    __entryFile: registration.filePath,
  };
  const worker = new Worker(WORKER_BOOTSTRAP, {
    eval: true,
    workerData,
  });

  let finalized = false;
  let ready = false;
  let status = WorkerStatus.Initializing;
  let nextCallId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      method: string;
    }
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
        status = WorkerStatus.Ready;
        resolveReady();
        return;
      case 'init-error': {
        status = WorkerStatus.InitError;
        const error = toError(message.error, 'Failed to initialize worker');
        rejectReady(error);
        rejectAll(error);
        return;
      }
      case 'result': {
        const callback = pending.get(message.id);
        if (!callback) return;
        pending.delete(message.id);
        if (message.ok) {
          // Decode return value
          decodeMethodReturn(cls.prototype, callback.method, message.result)
            .then((decoded) => callback.resolve(decoded))
            .catch((error) => callback.reject(error));
        } else {
          const failed = message as Extract<WorkerResultMessage, { ok: false }>;
          callback.reject(
            toError(failed.error, 'Worker method execution failed'),
          );
        }
        return;
      }
      case 'callback-invoke': {
        const callbackInvoke = message as WorkerCallbackInvokeMessage;
        if (!workerCallbacks.has(callbackInvoke.method)) {
          worker.postMessage({
            type: 'callback-result',
            id: callbackInvoke.id,
            ok: false,
            error: {
              message: `Method is not decorated with @WorkerCallback(): ${callbackInvoke.method}`,
            },
          } satisfies WorkerInvokeMessage);
          return;
        }

        const method = (instance as Record<string, unknown>)[
          callbackInvoke.method
        ];
        if (typeof method !== 'function') {
          worker.postMessage({
            type: 'callback-result',
            id: callbackInvoke.id,
            ok: false,
            error: {
              message: `Worker callback not found: ${callbackInvoke.method}`,
            },
          } satisfies WorkerInvokeMessage);
          return;
        }

        Promise.resolve()
          .then(async () => {
            // Decode arguments
            const decodedArgs = await decodeMethodArgs(
              cls.prototype,
              callbackInvoke.method,
              Array.isArray(callbackInvoke.args) ? callbackInvoke.args : [],
            );
            return method.apply(instance, decodedArgs);
          })
          .then(async (result: unknown) => {
            // Encode return value
            const encodedResult = await encodeMethodReturn(
              cls.prototype,
              callbackInvoke.method,
              result,
            );
            worker.postMessage({
              type: 'callback-result',
              id: callbackInvoke.id,
              ok: true,
              result: encodedResult,
            } satisfies WorkerInvokeMessage);
          })
          .catch((error: unknown) => {
            const callbackError: Extract<
              WorkerCallbackResultMessage,
              { ok: false }
            > = {
              type: 'callback-result',
              id: callbackInvoke.id,
              ok: false,
              error: serializeError(error),
            };
            worker.postMessage(callbackError satisfies WorkerInvokeMessage);
          });
        return;
      }
      case 'finalized':
      default:
        return;
    }
  });

  worker.on('error', (error) => {
    status = WorkerStatus.WorkerError;
    callEventHandlers('error', error);
    const err = toError(error, 'Worker error');
    if (!ready) rejectReady(err);
    rejectAll(err);
  });

  worker.on('exit', (code) => {
    if (!finalized) {
      status = WorkerStatus.Exited;
    }
    callEventHandlers('exit', code);
    if (!ready && !finalized) {
      rejectReady(new Error(`Worker exited before ready (code: ${code})`));
    }
    if (!finalized) {
      rejectAll(new Error(`Worker exited (code: ${code})`));
    }
  });

  worker.on('online', () => {
    callEventHandlers('online');
  });

  worker.on('messageerror', (error) => {
    callEventHandlers('messageerror', error);
  });

  const callWorkerMethod = async (
    name: string,
    methodArgs: unknown[],
  ): Promise<unknown> => {
    if (finalized)
      return Promise.reject(new Error('Worker has been finalized'));

    // Encode arguments
    const encodedArgs = await encodeMethodArgs(cls.prototype, name, methodArgs);

    return readyPromise.then(
      () =>
        new Promise((resolve, reject) => {
          const id = nextCallId;
          nextCallId += 1;
          pending.set(id, { resolve, reject, method: name });
          const message: WorkerInvokeMessage = {
            type: 'invoke',
            id,
            method: name,
            args: encodedArgs,
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
      status = WorkerStatus.Finalized;
      rejectAll(new Error('Worker has been finalized'));
      try {
        worker.postMessage({ type: 'finalize' } satisfies WorkerInvokeMessage);
      } catch {
        // Worker is already exiting.
      }
      await worker.terminate();
    },
  });

  Object.defineProperty(instance, 'workerStatus', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: (): WorkerStatus => status,
  });

  await readyPromise;
  return instance as WorkerInstance<InstanceType<C>>;
};
