import { Struct } from 'typed-struct';
import { WorkerMethod, DefineWorker } from '../..';

const Base = new Struct('SharedStructBase').UInt8('value').compile();

@DefineWorker()
export class SharedStructWorker extends Base {
  @WorkerMethod()
  setValue(value: number) {
    this.value = value;
    return this.value;
  }
}
