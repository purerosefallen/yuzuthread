import { Metadata, reflector } from './metadata';

export const WorkerMethod = (): MethodDecorator =>
  Metadata.set('workerMethod', true);

export const getWorkerMethods = (target: any): string[] =>
  reflector
    .getArray('workerMethodKeys', target)
    .filter((key) => reflector.get('workerMethod', target, key));
