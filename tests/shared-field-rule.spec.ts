import { TransportEncoder, TransportType } from '..';
import { shouldProcessSharedField } from '../src/utility/shared-field-rule';

const NoopPropertyDecorator = (): PropertyDecorator => () => {};

describe('shared field rule', () => {
  it('should process field when transporter class is non-built-in', () => {
    class TestClass {
      @TransportType(() => Buffer)
      value?: Buffer;
    }

    expect(shouldProcessSharedField(TestClass.prototype, 'value')).toBe(true);
  });

  it('should not process field when transporter class is built-in', () => {
    class TestClass {
      @TransportType(() => Date)
      value?: Buffer;
    }

    expect(shouldProcessSharedField(TestClass.prototype, 'value')).toBe(false);
  });

  it('should not process field when transporter is encoder', () => {
    class TestClass {
      @TransportEncoder(
        (value: Buffer) => new Uint8Array(value),
        (value: Uint8Array) => Buffer.from(value),
      )
      value?: Buffer;
    }

    expect(shouldProcessSharedField(TestClass.prototype, 'value')).toBe(false);
  });

  it('should fall back to design:type when transporter metadata is absent', () => {
    class TestClass {
      @NoopPropertyDecorator()
      value?: Buffer;
    }

    expect(shouldProcessSharedField(TestClass.prototype, 'value')).toBe(true);
  });

  it('should return false when no metadata exists', () => {
    class TestClass {
      value?: Buffer;
    }

    expect(shouldProcessSharedField(TestClass.prototype, 'value')).toBe(false);
  });
});
