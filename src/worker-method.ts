import { Metadata, reflector } from './utility/metadata';

export const WorkerMethod = (): MethodDecorator =>
  Metadata.set('workerMethod', true, 'workerMethodKeys');

export const WorkerCallback = (): MethodDecorator =>
  Metadata.set('workerCallback', true, 'workerCallbackKeys');

export const getWorkerMethods = (target: any): string[] =>
  reflector
    .getArray('workerMethodKeys', target)
    .filter((key) => reflector.get('workerMethod', target, key));

export const getWorkerCallbacks = (target: any): string[] =>
  reflector
    .getArray('workerCallbackKeys', target)
    .filter((key) => reflector.get('workerCallback', target, key));
