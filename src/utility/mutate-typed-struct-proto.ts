import { ClassType } from 'nfkit';
import { AnyStructConstructor } from './types';
import { findTypedStructClass } from './find-typed-struct-cls';

const BRIDGE_STATE = Symbol('yuzuthread.typedStructBridgeState');

type BridgeState = {
  cb: () => unknown[] | undefined;
};

type BridgeConstructor = AnyStructConstructor & {
  [BRIDGE_STATE]?: BridgeState;
};

const getBridgeState = (target: unknown): BridgeState | null => {
  if (typeof target !== 'function') return null;
  return ((target as BridgeConstructor)[BRIDGE_STATE] ??
    null) as BridgeState | null;
};

export const mutateTypedStructProto = <T = any>(
  cls: ClassType<T>,
  cb: () => unknown[] | undefined,
): boolean => {
  const existingClassBridgeState = getBridgeState(cls);
  if (existingClassBridgeState) {
    existingClassBridgeState.cb = cb;
    return true;
  }

  const structCls = findTypedStructClass(cls);
  if (!structCls) return false;
  const existingBridgeState = getBridgeState(structCls);
  if (existingBridgeState) {
    existingBridgeState.cb = cb;
    return true;
  }
  if (cls === structCls) return false;

  const bridgeState: BridgeState = { cb };
  const bridge = class extends (structCls as AnyStructConstructor) {
    constructor(...inputArgs: unknown[]) {
      const args = (bridgeState.cb() ?? inputArgs) as unknown[];
      if (args.length === 0) super();
      else if (args.length === 1) super(args[0] as never);
      else if (args.length === 2) super(args[0] as never, args[1] as never);
      else
        throw new TypeError(
          'typed-struct constructor accepts at most 2 arguments',
        );
    }
  };
  Object.defineProperty(bridge, BRIDGE_STATE, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: bridgeState,
  });

  let current: unknown = cls;
  let child: unknown = null;
  while (typeof current === 'function' && current !== structCls) {
    child = current;
    current = Object.getPrototypeOf(current);
  }

  if (current !== structCls) return false;

  const target = (child ?? cls) as ClassType<any>;
  try {
    Object.setPrototypeOf(target, bridge);
    Object.setPrototypeOf(target.prototype, bridge.prototype);
    return true;
  } catch {
    return false;
  }
};
