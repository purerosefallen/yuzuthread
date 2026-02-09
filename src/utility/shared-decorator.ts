import { AnyClass } from 'nfkit';
import { MetadataSetter, Reflector } from 'typed-reflector';
import { TransportType } from './transport-metadata';

/**
 * Factory function for Shared decorator type
 */
export type SharedTypeFactory = () => AnyClass;

/**
 * Metadata for a shared parameter
 */
export interface SharedParamInfo {
  index: number;
}

/**
 * Metadata map for shared parameters
 */
export interface SharedMetadataMap {}

export interface SharedMetadataArrayMap {
  sharedParams: SharedParamInfo;
}

export const SharedMetadata = new MetadataSetter<
  SharedMetadataMap,
  SharedMetadataArrayMap
>();

export const sharedReflector = new Reflector<
  SharedMetadataMap,
  SharedMetadataArrayMap
>();

/**
 * Mark a constructor parameter as shared memory
 * The parameter must contain shared memory segments (typed-struct, Buffer, SharedArrayBuffer, or nested classes with these)
 *
 * @param factory Optional factory function that returns the class type
 */
export const Shared = (factory?: SharedTypeFactory): ParameterDecorator => {
  return ((
    target: any,
    propertyKey: string | symbol | undefined,
    parameterIndex: number,
  ) => {
    // Validate that it's a constructor parameter
    if (propertyKey !== undefined) {
      throw new TypeError('@Shared can only be used on constructor parameters');
    }

    if (!factory) {
      const paramTypes =
        Reflect.getMetadata?.('design:paramtypes', target) || [];
      const paramType = paramTypes[parameterIndex];
      if (!paramType) {
        throw new TypeError(
          `@Shared parameter at index ${parameterIndex} has no type information. ` +
            'Either provide a factory function or enable emitDecoratorMetadata.',
        );
      }
      factory = () => paramType;
    }

    SharedMetadata.append('sharedParams', { index: parameterIndex })(target);

    // also register as TransportType
    TransportType(factory)(target, undefined, parameterIndex);
  }) as ParameterDecorator;
};

/**
 * Get all shared parameters for a class constructor
 */
export const getSharedParams = (target: AnyClass): SharedParamInfo[] => {
  return sharedReflector.getArray('sharedParams', target);
};
