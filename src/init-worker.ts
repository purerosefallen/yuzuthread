import { AnyClass } from 'nfkit';

export const initWorker = <C extends AnyClass>(
  cls: C,
  ...args: ConstructorParameters<C>
): Promise<InstanceType<C> & { finalize: () => Promise<void> }> => {
  return undefined;
};
