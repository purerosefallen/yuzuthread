import { AnyClass } from 'nfkit';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { getWorkerMethods } from './worker-method';
import { mutateTypedStructProto } from './utility/mutate-typed-struct-proto';

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
  | WorkerResultMessage;

export type WorkerDataPayload = {
  __yuzuthread: true;
  classId: string;
  ctorArgs: unknown[];
  typedStruct:
    | {
        mode: 'mutate' | 'ctor';
        sharedBuffer: SharedArrayBuffer;
      }
    | null;
};

export type WorkerRegistration = {
  id: string;
  filePath: string;
};

const THIS_FILE = __filename;
const REGISTRY = new WeakMap<AnyClass, WorkerRegistration>();
const STARTED = new Set<string>();

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

const toPath = (stackLine: string): string | null => {
  const line = stackLine.trim();
  const withParen = line.match(/\((.*):\d+:\d+\)$/);
  if (withParen && withParen[1]) return withParen[1];
  const direct = line.match(/at (.*):\d+:\d+$/);
  if (direct && direct[1]) return direct[1];
  return null;
};

const getDecoratorCallerFile = (): string | null => {
  const stack = new Error().stack;
  if (!stack) return null;
  const lines = stack.split('\n').slice(1);
  for (const line of lines) {
    const path = toPath(line);
    if (!path) continue;
    if (path === THIS_FILE) continue;
    if (path.includes('node_modules')) continue;
    return path;
  }
  return null;
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

const setupWorkerRuntime = async (cls: AnyClass, data: WorkerDataPayload): Promise<void> => {
  if (!parentPort) throw new Error('Worker parentPort is not available');
  const ctorArgs = [...data.ctorArgs];
  if (data.typedStruct) {
    const sharedBuffer = Buffer.from(data.typedStruct.sharedBuffer);
    if (data.typedStruct.mode === 'mutate') {
      let used = false;
      mutateTypedStructProto(cls, () => {
        if (used) return undefined;
        used = true;
        return [sharedBuffer, false];
      });
    } else {
      ctorArgs.splice(0, ctorArgs.length, sharedBuffer, false);
    }
  }

  const instance = new cls(...ctorArgs);
  const workerMethods = new Set(getWorkerMethods(cls.prototype));
  parentPort.on('message', async (message: WorkerInvokeMessage) => {
    if (!message || typeof message !== 'object') return;
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
        error: { message: `Method is not decorated with @WorkerMethod(): ${message.method}` },
      } satisfies WorkerHostMessage);
      return;
    }
    try {
      const result = await invokeWorkerMethod(
        instance as Record<string, unknown>,
        message.method,
        Array.isArray(message.args) ? message.args : [],
      );
      parentPort.postMessage({
        type: 'result',
        id: message.id,
        ok: true,
        result,
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

const tryStartWorkerForClass = (target: AnyClass, registration: WorkerRegistration): void => {
  if (isMainThread || !parentPort) return;
  const data = workerData as WorkerDataPayload | undefined;
  if (!data || data.__yuzuthread !== true) return;
  if (data.classId !== registration.id) return;
  if (STARTED.has(registration.id)) return;
  STARTED.add(registration.id);

  void setupWorkerRuntime(target, data).catch((error) => {
    parentPort.postMessage({
      type: 'init-error',
      error: serializeError(error),
    } satisfies WorkerHostMessage);
  });
};

export const Worker = (filePath?: string): ClassDecorator => {
  return (target) => {
    const cls = target as unknown as AnyClass;
    const existing = REGISTRY.get(cls);
    if (existing) {
      tryStartWorkerForClass(cls, existing);
      return;
    }
    const resolvedFilePath = filePath ?? getDecoratorCallerFile();
    if (!resolvedFilePath) {
      throw new Error('@Worker() failed: cannot resolve class file path');
    }
    const registration: WorkerRegistration = {
      id: `${resolvedFilePath}#${cls.name || 'AnonymousClass'}`,
      filePath: resolvedFilePath,
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
