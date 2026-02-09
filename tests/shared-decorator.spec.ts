import { Struct } from 'typed-struct';
import { Shared } from '../src/utility/shared-decorator';

const Base = new Struct('SharedDecoratorBase').UInt32LE('value').compile();

class SharedStruct extends Base {
  declare value: number;
}

describe('Shared decorator utilities', () => {
  describe('@Shared decorator', () => {
    it('should throw error when used on non-constructor parameters', () => {
      expect(() => {
        class TestClass {
          method(@Shared(() => SharedStruct) data: SharedStruct): void {}
        }
      }).toThrow('@Shared can only be used on constructor parameters');
    });
  });
});
