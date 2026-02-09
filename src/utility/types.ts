import { StructConstructor } from 'typed-struct';

export type AnyStructConstructor = StructConstructor<any, string>;

export enum WorkerStatus {
  Initializing = 'Initializing',
  Ready = 'Ready',
  InitError = 'InitError',
  WorkerError = 'WorkerError',
  Exited = 'Exited',
  Finalized = 'Finalized',
}
