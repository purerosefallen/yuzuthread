import { MetadataSetter, Reflector } from 'typed-reflector';
import { AnyClass } from 'nfkit';
import { safeScanTypedStructClass } from './typed-struct-registry';

export type Awaitable<T> = T | Promise<T>;

export type TransportTypeFactory = () => AnyClass | [AnyClass];

export type TransportEncoder<T = any, U = any> = {
  encode: (obj: T) => Awaitable<U>;
  decode: (encoded: U) => Awaitable<T>;
};

export type TransporterInfo =
  | { type: 'class'; factory: TransportTypeFactory }
  | { type: 'encoder'; encoder: TransportEncoder };

export type TransporterData =
  | { kind: 'return'; info: TransporterInfo }
  | { kind: 'property'; info: TransporterInfo }
  | { kind: 'params'; params: Map<number, TransporterInfo> };

export interface TransportMetadataMap {
  transporter: TransporterData;
}

export interface TransportMetadataArrayMap {
  transporterKeys: string | symbol;
}

export const TransportMetadata = new MetadataSetter<
  TransportMetadataMap,
  TransportMetadataArrayMap
>();
export const transportReflector = new Reflector<
  TransportMetadataMap,
  TransportMetadataArrayMap
>();

/**
 * Marks transport type for method return value, parameter, or property.
 * @param factory Optional factory function that returns the class or [class] for array
 */
export const TransportType = (
  factory?: TransportTypeFactory,
): PropertyDecorator & MethodDecorator & ParameterDecorator => {
  if (!factory) {
    // Try to get factory from design:type metadata
    return ((
      target: any,
      propertyKey?: string | symbol,
      parameterIndexOrDescriptor?: number | PropertyDescriptor,
    ) => {
      if (propertyKey === undefined) return;

      let resolvedFactory: TransportTypeFactory | undefined;

      try {
        if (typeof parameterIndexOrDescriptor === 'number') {
          // Parameter: get param type
          const paramTypes: any[] =
            Reflect.getMetadata?.(
              'design:paramtypes',
              target,
              propertyKey as string,
            ) || [];
          const paramType = paramTypes[parameterIndexOrDescriptor];
          if (paramType) {
            resolvedFactory = () => paramType;
            safeScanTypedStructClass(paramType);
          }
        } else if (parameterIndexOrDescriptor === undefined) {
          // Property: get property type
          const propType = Reflect.getMetadata?.(
            'design:type',
            target,
            propertyKey as string,
          );
          if (propType) {
            resolvedFactory = () => propType;
            safeScanTypedStructClass(propType);
          }
        } else if (typeof parameterIndexOrDescriptor === 'object') {
          // Method: get return type
          const returnType = Reflect.getMetadata?.(
            'design:returntype',
            target,
            propertyKey as string,
          );
          if (returnType) {
            resolvedFactory = () => returnType;
            safeScanTypedStructClass(returnType);
          }
        }
      } catch {
        // Ignore errors
      }

      // If we have a resolved factory, register metadata directly
      if (resolvedFactory) {
        const info: TransporterInfo = { type: 'class', factory: resolvedFactory };

        if (typeof parameterIndexOrDescriptor === 'number') {
          // Parameter decorator
          const paramIndex = parameterIndexOrDescriptor;
          
          // For constructor parameters, propertyKey is undefined
          // For method parameters, propertyKey is the method name
          const key = propertyKey as string | undefined;
          
          const existing = transportReflector.get(
            'transporter',
            target,
            key as any,
          );
          let params: Map<number, TransporterInfo>;

          if (existing && existing.kind === 'params') {
            params = existing.params;
          } else {
            params = new Map<number, TransporterInfo>();
          }

          params.set(paramIndex, info);
          const data: TransporterData = { kind: 'params', params };
          
          if (key) {
            // Method parameter
            TransportMetadata.set('transporter', data, 'transporterKeys')(target, key);
          } else {
            // Constructor parameter - store without propertyKey
            Reflect.defineMetadata?.('transporter', data, target);
          }
        } else if (parameterIndexOrDescriptor === undefined) {
          // Property decorator
          const data: TransporterData = { kind: 'property', info };
          TransportMetadata.set('transporter', data, 'transporterKeys')(target, propertyKey as string);
        } else if (typeof parameterIndexOrDescriptor === 'object') {
          // Method decorator (return type)
          const data: TransporterData = { kind: 'return', info };
          TransportMetadata.set('transporter', data, 'transporterKeys')(target, propertyKey as string);
        }
      }
    }) as any;
  }

  return ((
    target: any,
    propertyKey?: string | symbol,
    parameterIndexOrDescriptor?: number | PropertyDescriptor,
  ) => {
    // Check if this is a class decorator (both propertyKey and parameterIndex are undefined)
    if (propertyKey === undefined && parameterIndexOrDescriptor === undefined) {
      // Class decorator - not supported
      throw new Error('@TransportType cannot be used as a class decorator');
    }

    // Scan the class from factory
    try {
      const result = factory();
      const cls = Array.isArray(result) ? result[0] : result;
      safeScanTypedStructClass(cls);
    } catch {
      // Ignore errors (class might not be defined yet)
    }

    // Also scan design: types
    try {
      if (typeof parameterIndexOrDescriptor === 'number') {
        // Parameter: scan all param types
        const paramTypes: any[] =
          Reflect.getMetadata?.(
            'design:paramtypes',
            target,
            propertyKey as string,
          ) || [];
        for (const paramType of paramTypes) {
          safeScanTypedStructClass(paramType);
        }
      } else if (parameterIndexOrDescriptor === undefined) {
        // Property: scan property type
        const propType = Reflect.getMetadata?.(
          'design:type',
          target,
          propertyKey as string,
        );
        if (propType) {
          safeScanTypedStructClass(propType);
        }
      } else if (typeof parameterIndexOrDescriptor === 'object') {
        // Method: scan return type and all param types
        const returnType = Reflect.getMetadata?.(
          'design:returntype',
          target,
          propertyKey as string,
        );
        if (returnType) {
          safeScanTypedStructClass(returnType);
        }
        const paramTypes: any[] =
          Reflect.getMetadata?.(
            'design:paramtypes',
            target,
            propertyKey as string,
          ) || [];
        for (const paramType of paramTypes) {
          safeScanTypedStructClass(paramType);
        }
      }
    } catch {
      // Ignore errors
    }

    const info: TransporterInfo = { type: 'class', factory };

    if (typeof parameterIndexOrDescriptor === 'number') {
      // Parameter decorator
      const paramIndex = parameterIndexOrDescriptor;
      
      // For constructor parameters, propertyKey is undefined
      // For method parameters, propertyKey is the method name
      const key = propertyKey as string | undefined;
      
      const existing = transportReflector.get(
        'transporter',
        target,
        key as any,
      );
      let params: Map<number, TransporterInfo>;

      if (existing && existing.kind === 'params') {
        params = existing.params;
      } else {
        params = new Map<number, TransporterInfo>();
      }

      params.set(paramIndex, info);
      const data: TransporterData = { kind: 'params', params };
      
      if (key) {
        // Method parameter
        TransportMetadata.set('transporter', data, 'transporterKeys')(target, key);
      } else {
        // Constructor parameter - store without propertyKey
        Reflect.defineMetadata?.('transporter', data, target);
      }
    } else if (parameterIndexOrDescriptor === undefined) {
      // Property decorator
      const data: TransporterData = { kind: 'property', info };
      TransportMetadata.set('transporter', data, 'transporterKeys')(target, propertyKey as string);
    } else if (typeof parameterIndexOrDescriptor === 'object') {
      // Method decorator (return type)
      const data: TransporterData = { kind: 'return', info };
      TransportMetadata.set('transporter', data, 'transporterKeys')(target, propertyKey as string);
    }
  }) as any;
};

/**
 * Custom encoder/decoder for transport.
 * @param encode Function to encode object
 * @param decode Function to decode object
 */
export const TransportEncoder = <T = any, U = any>(
  encode: (obj: T) => Awaitable<U>,
  decode: (encoded: U) => Awaitable<T>,
): PropertyDecorator & MethodDecorator & ParameterDecorator => {
  const encoder: TransportEncoder<T, U> = { encode, decode };
  const info: TransporterInfo = { type: 'encoder', encoder };

  return ((
    target: any,
    propertyKey?: string | symbol,
    parameterIndexOrDescriptor?: number | PropertyDescriptor,
  ) => {
    // Check if this is a class decorator
    if (propertyKey === undefined && parameterIndexOrDescriptor === undefined) {
      throw new Error('@TransportEncoder cannot be used as a class decorator');
    }

    if (typeof parameterIndexOrDescriptor === 'number') {
      // Parameter decorator
      const paramIndex = parameterIndexOrDescriptor;
      
      // For constructor parameters, propertyKey is undefined
      // For method parameters, propertyKey is the method name
      const key = propertyKey as string | undefined;
      
      const existing = transportReflector.get(
        'transporter',
        target,
        key as any,
      );
      let params: Map<number, TransporterInfo>;

      if (existing && existing.kind === 'params') {
        params = existing.params;
      } else {
        params = new Map<number, TransporterInfo>();
      }

      params.set(paramIndex, info);
      const data: TransporterData = { kind: 'params', params };
      
      if (key) {
        // Method parameter
        TransportMetadata.set('transporter', data, 'transporterKeys')(target, key);
      } else {
        // Constructor parameter - store without propertyKey
        Reflect.defineMetadata?.('transporter', data, target);
      }
    } else if (parameterIndexOrDescriptor === undefined) {
      // Property decorator
      const data: TransporterData = { kind: 'property', info };
      TransportMetadata.set('transporter', data, 'transporterKeys')(target, propertyKey as string);
    } else if (typeof parameterIndexOrDescriptor === 'object') {
      // Method decorator (return type)
      const data: TransporterData = { kind: 'return', info };
      TransportMetadata.set('transporter', data, 'transporterKeys')(target, propertyKey as string);
    }
  }) as any;
};

/**
 * Get transporter info for method return type
 */
export const getReturnTransporter = (
  target: any,
  propertyKey: string,
): TransporterInfo | null => {
  const data = transportReflector.get('transporter', target, propertyKey);
  if (!data) return null;
  if (data.kind === 'return') return data.info;
  return null;
};

/**
 * Get transporter info for method parameters
 */
export const getParamTransporters = (
  target: any,
  propertyKey: string,
): Map<number, TransporterInfo> => {
  const data = transportReflector.get('transporter', target, propertyKey);
  if (!data) return new Map();
  if (data.kind === 'params') return data.params;
  return new Map();
};

/**
 * Get transporter info for property
 */
export const getPropertyTransporter = (
  target: any,
  propertyKey: string,
): TransporterInfo | null => {
  const data = transportReflector.get('transporter', target, propertyKey);
  if (!data) return null;
  if (data.kind === 'property') return data.info;
  return null;
};
