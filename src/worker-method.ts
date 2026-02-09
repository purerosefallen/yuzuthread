import { Metadata, reflector, WorkerEventName } from './utility/metadata';

export const WorkerMethod = (): MethodDecorator =>
  Metadata.set('workerMethod', true, 'workerMethodKeys');

export const WorkerCallback = (): MethodDecorator =>
  Metadata.set('workerCallback', true, 'workerCallbackKeys');

export const OnWorkerEvent = (event: WorkerEventName): MethodDecorator =>
  Metadata.appendUnique('workerEvent', event, 'workerEventKeys');

export const OnWorkerExit = (): MethodDecorator => OnWorkerEvent('exit');

export const OnWorkerError = (): MethodDecorator => OnWorkerEvent('error');

export const getWorkerMethods = (target: any): string[] =>
  reflector
    .getArray('workerMethodKeys', target)
    .filter((key) => reflector.get('workerMethod', target, key));

export const getWorkerCallbacks = (target: any): string[] =>
  reflector
    .getArray('workerCallbackKeys', target)
    .filter((key) => reflector.get('workerCallback', target, key));

export const getWorkerEventHandlers = (target: any): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  const keys = reflector.getArray('workerEventKeys', target);
  for (const key of keys) {
    const events = reflector.getArray('workerEvent', target, key);
    for (const event of events) {
      const handlers = map.get(event) ?? [];
      handlers.push(key);
      map.set(event, handlers);
    }
  }
  return map;
};
