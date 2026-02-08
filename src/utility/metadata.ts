import { MetadataSetter, Reflector } from "typed-reflector";

export interface MetadataMap {
  workerMethod: boolean;
  workerCallback: boolean;
}

export interface MetadataArrayMap {
  workerMethodKeys: string;
  workerCallbackKeys: string;
}

export const Metadata = new MetadataSetter<MetadataMap, MetadataArrayMap>();
export const reflector = new Reflector<MetadataMap, MetadataArrayMap>();
