import { MetadataSetter, Reflector } from "typed-reflector";

export interface MetadataMap {
  workerMethod: boolean;
}

export interface MetadataArrayMap {
  workerMethodKeys: string;
}

export const Metadata = new MetadataSetter<MetadataMap, MetadataArrayMap>();
export const reflector = new Reflector<MetadataMap, MetadataArrayMap>();
