import { MetadataSetter, Reflector } from 'typed-reflector';
import type { Worker } from 'node:worker_threads';

export type WorkerEventName = Extract<Parameters<Worker['on']>[0], string>;

export interface MetadataMap {
  workerMethod: boolean;
  workerCallback: boolean;
}

export interface MetadataArrayMap {
  workerMethodKeys: string;
  workerCallbackKeys: string;
  workerEventKeys: string;
  workerEvent: WorkerEventName;
}

export const Metadata = new MetadataSetter<MetadataMap, MetadataArrayMap>();
export const reflector = new Reflector<MetadataMap, MetadataArrayMap>();
