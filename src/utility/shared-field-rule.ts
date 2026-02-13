import { AnyClass } from 'nfkit';
import { TransporterInfo, getPropertyTransporter } from './transport-metadata';
import { isBuiltinType } from './type-helpers';

const resolveTransporterClass = (
  transporter: TransporterInfo,
): AnyClass | null => {
  if (transporter.type !== 'class') {
    return null;
  }

  const factoryResult = transporter.factory();
  return Array.isArray(factoryResult) ? factoryResult[0] : factoryResult;
};

export const shouldProcessSharedField = (proto: any, key: string): boolean => {
  if (!proto) {
    return false;
  }

  const transporter = getPropertyTransporter(proto, key);
  if (transporter) {
    const transporterClass = resolveTransporterClass(transporter);
    return !isBuiltinType(transporterClass);
  }

  const designType = Reflect.getMetadata?.('design:type', proto, key);
  if (!designType) {
    return false;
  }

  return !isBuiltinType(designType);
};
