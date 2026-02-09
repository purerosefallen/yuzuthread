import { AnyClass } from 'nfkit';
import { Worker } from 'node:worker_threads';
import { getWorkerCallbacks, getWorkerMethods } from './worker-method';
import {
  getWorkerRegistration,
  WorkerCallbackInvokeMessage,
  WorkerCallbackResultMessage,
  WorkerDataPayload,
  WorkerHostMessage,
  WorkerInvokeMessage,
  WorkerResultMessage,
} from './worker';

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

export const initWorker = async <C extends AnyClass>(
  cls: C,
  ...args: ConstructorParameters<C>
): Promise<InstanceType<C> & { finalize: () => Promise<void> }> => {
  const registration = getWorkerRegistration(cls);
  if (!registration) {
    throw new Error(`@DefineWorker() is required for ${cls.name || 'AnonymousClass'}`);
  }

  const workerMethods = getWorkerMethods(cls.prototype);
  const workerCallbacks = new Set(getWorkerCallbacks(cls.prototype));
  const localArgs = [...args] as unknown[];
  let typedStructPayload: WorkerDataPayload['typedStruct'] = null;
  const typedStruct = registration.typedStruct;

  if (typedStruct) {
    const { byteLength, initial } = typedStruct.resolveBufferInfo(localArgs);
    const sharedMemory = new SharedArrayBuffer(byteLength);
    const sharedBuffer = Buffer.from(sharedMemory);
    if (initial) Buffer.from(initial).copy(sharedBuffer);
    if (typedStruct.mode === 'mutate') {
      typedStruct.setOneShotArgs([sharedBuffer, false]);
    } else {
      localArgs.splice(0, localArgs.length, sharedBuffer, false);
    }
    typedStructPayload = { sharedBuffer: sharedMemory };
  }

  const instance = new cls(...(localArgs as ConstructorParameters<C>));
  const workerData: WorkerDataPayload & {
    __entryFile: string;
  } = {
    __yuzuthread: true,
    classId: registration.id,
    ctorArgs: args as unknown[],
    typedStruct: typedStructPayload,
    __entryFile: registration.filePath,
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
      case 'callback-invoke': {
        const callbackInvoke = message as WorkerCallbackInvokeMessage;
        if (!workerCallbacks.has(callbackInvoke.method)) {
          worker.postMessage({
            type: 'callback-result',
            id: callbackInvoke.id,
            ok: false,
            error: { message: `Method is not decorated with @WorkerCallback(): ${callbackInvoke.method}` },
          } satisfies WorkerInvokeMessage);
          return;
        }

        const method = (instance as Record<string, unknown>)[callbackInvoke.method];
        if (typeof method !== 'function') {
          worker.postMessage({
            type: 'callback-result',
            id: callbackInvoke.id,
            ok: false,
            error: { message: `Worker callback not found: ${callbackInvoke.method}` },
          } satisfies WorkerInvokeMessage);
          return;
        }

        Promise.resolve()
          .then(() =>
            method.apply(
              instance,
              Array.isArray(callbackInvoke.args) ? callbackInvoke.args : [],
            ),
          )
          .then((result: unknown) => {
            worker.postMessage({
              type: 'callback-result',
              id: callbackInvoke.id,
              ok: true,
              result,
            } satisfies WorkerInvokeMessage);
          })
          .catch((error: unknown) => {
            const callbackError: Extract<WorkerCallbackResultMessage, { ok: false }> = {
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
