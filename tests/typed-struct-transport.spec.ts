import { initWorker } from '..';
import { TypedStructTransportWorker } from './fixtures/typed-struct-transport.worker.js';

describe('Typed Struct Transport', () => {
  let worker: Awaited<ReturnType<typeof initWorker<typeof TypedStructTransportWorker>>>;

  beforeAll(async () => {
    worker = await initWorker(TypedStructTransportWorker);
  });

  afterAll(async () => {
    await worker.finalize();
  });

  it('should transport typed-struct class', async () => {
    const result = await worker.createData();
    expect(result).toHaveProperty('value', 42);
    expect(result).toHaveProperty('count', 100);
    expect(result).toHaveProperty('extraField', 'test');
    expect(result).toHaveProperty('nestedData');
    expect(result.nestedData).toEqual({ name: 'example' });
  });

  it('should transport typed-struct class as parameter', async () => {
    const input = await worker.createData();
    const result = await worker.modifyData(input);
    
    expect(result).toHaveProperty('value', 84);
    expect(result).toHaveProperty('count', 101);
    expect(result).toHaveProperty('extraField', 'test modified');
    expect(result).toHaveProperty('nestedData');
    expect(result.nestedData).toEqual({ name: 'example!' });
  });

  it('should transport array of typed-struct classes', async () => {
    const result = await worker.createArray();
    
    expect(result).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(result[i]).toHaveProperty('value', i);
      expect(result[i]).toHaveProperty('count', i * 10);
      expect(result[i]).toHaveProperty('extraField', `item${i}`);
    }
  });

  it('should preserve struct buffer data', async () => {
    const data1 = await worker.createData();
    const data2 = await worker.modifyData(data1);
    
    // Verify that struct fields are correctly preserved
    expect(data1.value).toBe(42);
    expect(data2.value).toBe(84);
    
    // Verify that data maintains struct behavior (can read/write struct fields)
    expect(data1.count).toBe(100);
    expect(data2.count).toBe(101);
    
    // Verify non-struct fields are also preserved
    expect(data1.extraField).toBe('test');
    expect(data2.extraField).toBe('test modified');
  });

  describe('Mixed scenarios with @Transport decorators', () => {
    it('should handle typed-struct with @TransportType on nested field', async () => {
      const result = await worker.createComplexData();
      
      // Verify struct fields
      expect(result).toHaveProperty('value', 1);
      expect(result).toHaveProperty('count', 2);
      
      // Verify plain field
      expect(result).toHaveProperty('plainField', 'plain');
      
      // Verify nested typed-struct
      expect(result).toHaveProperty('nested');
      expect(result.nested).toHaveProperty('value', 10);
      expect(result.nested).toHaveProperty('count', 20);
      expect(result.nested).toHaveProperty('extraField', 'nested');
    });

    it('should handle typed-struct with @TransportType on nested field as parameter', async () => {
      const input = await worker.createComplexData();
      const result = await worker.processComplexData(input);
      
      expect(result).toHaveProperty('value', 2);
      expect(result).toHaveProperty('count', 7);
      expect(result).toHaveProperty('plainField', 'plain processed');
      
      expect(result.nested).toHaveProperty('value', 11);
      expect(result.nested).toHaveProperty('count', 21);
      expect(result.nested).toHaveProperty('extraField', 'nested!');
    });

    it('should handle typed-struct with @TransportEncoder on field', async () => {
      const result = await worker.createEncodedData();
      
      expect(result).toHaveProperty('value', 99);
      expect(result).toHaveProperty('count', 100);
      expect(result).toHaveProperty('timestamp');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should handle typed-struct with @TransportEncoder as parameter', async () => {
      const input = await worker.createEncodedData();
      const result = await worker.processEncodedData(input);
      
      expect(result).toHaveProperty('value', 100);
      expect(result).toHaveProperty('count', 101);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp?.toISOString()).toBe('2024-01-02T00:00:00.000Z');
    });
  });

  describe('Regular class with typed-struct field', () => {
    it('should handle regular class with typed-struct field', async () => {
      const result = await worker.createWrapper();
      
      expect(result).toHaveProperty('label', 'wrapper-label');
      expect(result).toHaveProperty('data');
      
      // Verify the typed-struct field
      expect(result.data).toHaveProperty('value', 5);
      expect(result.data).toHaveProperty('count', 10);
      expect(result.data).toHaveProperty('extraField', 'wrapped');
    });

    it('should handle regular class with typed-struct field as parameter', async () => {
      const input = await worker.createWrapper();
      const result = await worker.processWrapper(input);
      
      expect(result).toHaveProperty('label', 'wrapper-label processed');
      expect(result.data).toHaveProperty('value', 10);
      expect(result.data).toHaveProperty('count', 20);
      expect(result.data).toHaveProperty('extraField', 'wrapped modified');
    });

    it('should handle array of regular class with typed-struct field', async () => {
      const result = await worker.createWrapperArray();
      
      expect(result).toHaveLength(2);
      
      for (let i = 0; i < 2; i++) {
        expect(result[i]).toHaveProperty('label', `label${i}`);
        expect(result[i].data).toHaveProperty('value', i);
        expect(result[i].data).toHaveProperty('count', i * 5);
        expect(result[i].data).toHaveProperty('extraField', `item${i}`);
      }
    });
  });
});
