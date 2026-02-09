import { initWorker } from '..';
import { TransportWorker } from './fixtures/transport.worker.js';
import { CircularRefWorker, Node } from './fixtures/circular-ref.worker.js';

class CustomData {
  constructor(
    public value: number,
    public text: string,
  ) {}
}

class NestedData {
  data!: CustomData;

  constructor(data: CustomData) {
    this.data = data;
  }
}

describe('transport', () => {
  it('should transport custom class', async () => {
    const worker = await initWorker(TransportWorker);

    const input = new CustomData(5, 'hello');
    const result = await worker.createCustomData(input);

    expect(result).toHaveProperty('value', 10);
    expect(result).toHaveProperty('text', 'HELLO');
    expect(typeof result).toBe('object');

    await worker.finalize();
  });

  it('should transport array of custom class', async () => {
    const worker = await initWorker(TransportWorker);

    const input = [
      new CustomData(1, 'a'),
      new CustomData(2, 'b'),
      new CustomData(3, 'c'),
    ];
    const result = await worker.processArray(input);

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('value', 2);
    expect(result[0]).toHaveProperty('text', 'a!');
    expect(result[2]).toHaveProperty('value', 4);
    expect(result[2]).toHaveProperty('text', 'c!');

    await worker.finalize();
  });

  it('should transport nested custom class', async () => {
    const worker = await initWorker(TransportWorker);

    const input = new NestedData(new CustomData(10, 'test'));
    const result = await worker.processNested(input);

    expect(result).toHaveProperty('data');
    expect(result.data).toHaveProperty('value', 30);
    expect(result.data).toHaveProperty('text', 'test nested');

    await worker.finalize();
  });

  it('should transport Buffer', async () => {
    const worker = await initWorker(TransportWorker);

    const input = Buffer.from('hello');
    const result = await worker.processBuffer(input);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe('HELLO');

    await worker.finalize();
  });

  it('should use custom encoder', async () => {
    const worker = await initWorker(TransportWorker);

    const input = new Date('2024-01-01');
    const result = await worker.encodeDate(input);

    expect(result).toBeInstanceOf(Date);
    expect(result.getDate()).toBe(2);
    expect(result.getMonth()).toBe(0);
    expect(result.getFullYear()).toBe(2024);

    await worker.finalize();
  });

  it('should transport custom class in callback', async () => {
    const worker = await initWorker(TransportWorker);

    const result = await worker.callCustomCallback(42, 'callback');

    expect(result).toHaveProperty('value', 142);
    expect(result).toHaveProperty('text', 'callback from main');

    await worker.finalize();
  });

  it('should throw error for circular references in transport', async () => {
    const worker = await initWorker(CircularRefWorker);

    const node1 = new Node(10);
    const node2 = new Node(20);
    node1.next = node2;
    node2.next = node1; // Create circular reference

    // Should throw error when attempting to transport
    await expect(worker.processNode(node1)).rejects.toThrow(
      'Circular reference detected',
    );

    await worker.finalize();
  });
});
