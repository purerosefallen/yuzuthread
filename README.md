# yuzuthread

A lightweight, class-first `worker_threads` library for Node.js.  
Define a class with decorators, run methods in a worker thread, and keep a mirrored instance on the main thread.

## Why

`yuzuthread` is built around a few practical goals:

- Organize worker logic with classes instead of manual message protocols.
- Keep method calls ergonomic and object-oriented.
- Automatically use shared memory for `typed-struct` classes.
- Stay non-intrusive: your class can still be used with plain `new`.

## Install

```bash
npm i yuzuthread typed-struct
```

`typed-struct` is required because `yuzuthread` declares it as a peer dependency.

### TypeScript Configuration

Enable decorators in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

- `experimentalDecorators` is required for all decorators
- `emitDecoratorMetadata` enables automatic type inference for `@TransportType()`

## Define a Worker Class

Put each worker class in its own file and add `@DefineWorker()`.

```ts
// counter.worker.ts
import { isMainThread } from 'node:worker_threads';
import { DefineWorker, WorkerMethod, WorkerCallback } from 'yuzuthread';

@DefineWorker()
export class CounterWorker {
  count = 0;

  @WorkerMethod()
  async increment(step: number) {
    this.count += step;
    return { count: this.count, isMainThread };
  }

  @WorkerMethod()
  add(a: number, b: number) {
    return a + b;
  }

  @WorkerCallback()
  onMainAdd(a: number, b: number) {
    this.count += a + b;
    return { count: this.count, isMainThread };
  }

  @WorkerMethod()
  async callMainAdd(a: number, b: number) {
    return this.onMainAdd(a, b);
  }
}
```

## Long-running Worker (`initWorker`)

`initWorker` creates a persistent worker instance.  
Methods marked with `@WorkerMethod()` are proxied to the worker thread.  
You still hold a main-thread instance of the same class.

```ts
import { initWorker } from 'yuzuthread';
import { CounterWorker } from './counter.worker.js';

const counter = await initWorker(CounterWorker);

console.log(await counter.increment(2));
// -> { count: 2, isMainThread: false }

console.log(counter.count);
// -> 0 (main-thread instance state)

await counter.finalize();
```

## One-time Worker (`runInWorker`)

`runInWorker` is for fire-and-forget style work: create worker, run callback, finalize automatically.

```ts
import { runInWorker } from 'yuzuthread';
import { CounterWorker } from './counter.worker.js';

const value = await runInWorker(
  CounterWorker,
  async (counter) => {
    await counter.increment(2);
    const result = await counter.increment(3);
    return result.count;
  },
);

console.log(value); // -> 5
```

## Reverse Calls with `WorkerCallback`

`@WorkerCallback()` is the reverse direction:

- Called on the main thread: runs locally like a normal method.
- Called inside the worker thread: forwarded to main thread, then result is sent back.

Use this when worker-side logic needs to call back into main-thread state or services.

## `typed-struct` Shared Memory

If a worker class inherits from a compiled `typed-struct` class, `yuzuthread` automatically:

- Detects the struct class and computes buffer size.
- Creates a `SharedArrayBuffer`.
- Injects the shared buffer into both main-thread and worker-thread instances.

So both sides operate on the same underlying memory.

```ts
import { Struct } from 'typed-struct';
import { DefineWorker, WorkerMethod, initWorker } from 'yuzuthread';

const Base = new Struct('SharedStructBase').UInt8('value').compile();

@DefineWorker()
class SharedStructWorker extends Base {
  @WorkerMethod()
  setValue(value: number) {
    this.value = value;
    return this.value;
  }
}

const instance = await initWorker(SharedStructWorker, [0x10]);
await instance.setValue(0x7f);
console.log(instance.value); // -> 0x7f
await instance.finalize();
```

## Custom Class Transport

By default, `worker_threads` can only pass serializable data (primitives, plain objects, `Buffer`, etc.). For custom classes, `yuzuthread` provides transport decorators to automatically serialize and deserialize instances.

### Basic Class Transport

Use `@TransportType()` to mark parameters and return values that need class restoration:

```ts
import { DefineWorker, WorkerMethod, TransportType, initWorker } from 'yuzuthread';

class UserData {
  constructor(
    public id: number,
    public name: string,
  ) {}

  greet() {
    return `Hello, ${this.name}!`;
  }
}

@DefineWorker()
class DataWorker {
  @WorkerMethod()
  @TransportType(() => UserData)  // Return type
  async processUser(
    @TransportType(() => UserData) user: UserData,  // Parameter
  ): Promise<UserData> {
    return new UserData(user.id, user.name.toUpperCase());
  }
}

const worker = await initWorker(DataWorker);
const input = new UserData(1, 'alice');
const result = await worker.processUser(input);

console.log(result.greet()); // -> "Hello, ALICE!"
await worker.finalize();
```

### Array Transport

Use `[Class]` syntax for arrays:

```ts
@DefineWorker()
class BatchWorker {
  @WorkerMethod()
  @TransportType(() => [UserData])
  async processBatch(
    @TransportType(() => [UserData]) users: UserData[],
  ): Promise<UserData[]> {
    return users.map((u) => new UserData(u.id + 100, u.name.toLowerCase()));
  }
}
```

### Nested Objects

For classes with custom-class properties, add `@TransportType()` to the property:

```ts
class Address {
  constructor(
    public city: string,
    public country: string,
  ) {}
}

class Person {
  @TransportType(() => Address)
  address!: Address;

  constructor(
    public name: string,
    address: Address,
  ) {
    this.address = address;
  }
}

@DefineWorker()
class PersonWorker {
  @WorkerMethod()
  @TransportType(() => Person)
  async processPerson(
    @TransportType(() => Person) person: Person,
  ): Promise<Person> {
    return new Person(
      person.name,
      new Address(person.address.city.toUpperCase(), person.address.country),
    );
  }
}
```

### Custom Encoder

For complex serialization logic, use `@TransportEncoder()`:

```ts
import { DefineWorker, WorkerMethod, TransportEncoder, initWorker } from 'yuzuthread';

@DefineWorker()
class DateWorker {
  @WorkerMethod()
  @TransportEncoder(
    (date: Date) => date.toISOString(),
    (str: string) => new Date(str),
  )
  async addDay(
    @TransportEncoder(
      (date: Date) => date.toISOString(),
      (str: string) => new Date(str),
    )
    date: Date,
  ): Promise<Date> {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return next;
  }
}

const worker = await initWorker(DateWorker);
const today = new Date('2024-01-01');
const tomorrow = await worker.addDay(today);
console.log(tomorrow); // -> Date('2024-01-02')
await worker.finalize();
```

Encoders support async operations:

```ts
@TransportEncoder(
  async (obj: MyClass) => {
    // async encoding logic
    return await serialize(obj);
  },
  async (data: string) => {
    // async decoding logic
    return await deserialize(data);
  },
)
```

### Built-in Type Handling

- **Primitives** (`string`, `number`, `boolean`, etc.) - passed as-is
- **Built-in objects** (`Date`, `RegExp`, `Map`, `Set`, etc.) - handled by structured clone
- **Buffer** - automatically encoded/decoded with `Uint8Array`
- **TypedArrays** (`Uint8Array`, `Int32Array`, etc.) - passed directly
- **Plain objects** - passed as-is
- **Custom classes** - require `@TransportType()` or `@TransportEncoder()`

### Notes on Transport

- `@TransportType()` can be used without arguments to enable `emitDecoratorMetadata` without registering metadata
- Transport decorators work with both `@WorkerMethod()` and `@WorkerCallback()`
- Multiple `@TransportType()` can be stacked (e.g., for method + parameters)
- Encoding/decoding happens automatically during method calls
- Transport uses structured clone algorithm with custom class restoration

## Worker Status

You can check the worker status at any time using `workerStatus()`:

```ts
const worker = await initWorker(CounterWorker);
console.log(worker.workerStatus()); // -> 'Ready'

await worker.increment(5);
console.log(worker.workerStatus()); // -> 'Ready'

await worker.finalize();
console.log(worker.workerStatus()); // -> 'Finalized'
```

Possible status values (`WorkerStatus` enum):
- `Initializing` - Worker is being created
- `Ready` - Worker is ready to accept calls
- `InitError` - Worker failed to initialize
- `WorkerError` - Worker encountered a runtime error
- `Exited` - Worker exited unexpectedly
- `Finalized` - Worker was finalized via `finalize()`

## Worker Event Handlers

You can handle worker lifecycle events in the main thread using event decorators:

```ts
import { DefineWorker, WorkerMethod, OnWorkerEvent, OnWorkerExit, OnWorkerError, initWorker } from 'yuzuthread';

@DefineWorker()
class MonitoredWorker {
  @WorkerMethod()
  async doWork() {
    // some work
  }

  @OnWorkerError()
  handleError(error: Error) {
    console.log('Worker error:', error.message);
  }

  @OnWorkerExit()
  handleExit(code: number) {
    console.log('Worker exited with code:', code);
  }

  @OnWorkerEvent('online')
  handleOnline() {
    console.log('Worker is online');
  }

  // One method can handle multiple events
  @OnWorkerEvent('online')
  @OnWorkerEvent('exit')
  handleMultipleEvents(arg?: unknown) {
    console.log('Worker online or exited');
  }
}

const worker = await initWorker(MonitoredWorker);
// Event handlers will be called automatically when events occur
```

Available decorators:
- `@OnWorkerEvent(event: WorkerEventName)` - Handle any worker event (e.g., 'online', 'message', 'messageerror')
  - `WorkerEventName` is typed to match `Worker.on()` events for type safety
  - Can be stacked on the same method to handle multiple events
- `@OnWorkerError()` - Shorthand for `@OnWorkerEvent('error')`
- `@OnWorkerExit()` - Shorthand for `@OnWorkerEvent('exit')`

Event handlers run on the main thread and can access the main-thread instance state. Multiple handlers can be registered for the same event, and one method can handle multiple events. If a handler throws an error, it will be logged but won't affect other handlers or worker operation.

## API

### Decorators

#### Worker Definition

- `DefineWorker(options?)`
  - `options.filePath?`: worker file path override (optional, auto-inferred by default)
  - `options.id?`: custom class registration ID (optional)

#### Method Execution

- `WorkerMethod()`
  - marks a method to execute on worker thread
- `WorkerCallback()`
  - marks a method to execute on main thread when called from worker

#### Event Handlers

- `OnWorkerEvent(event: WorkerEventName)`
  - marks a method to handle worker events on main thread
  - `WorkerEventName` is typed to match `Worker.on()` for type safety
  - supports: 'error', 'exit', 'online', 'message', 'messageerror'
  - can be stacked on the same method to handle multiple events
- `OnWorkerError()`
  - shorthand for `@OnWorkerEvent('error')`
- `OnWorkerExit()`
  - shorthand for `@OnWorkerEvent('exit')`

#### Data Transport

- `TransportType(factory?: () => Class | [Class])`
  - marks parameter, return value, or property for custom class transport
  - use `() => Class` for single instance
  - use `() => [Class]` for arrays
  - can be used without arguments to enable `emitDecoratorMetadata` only
  - works as `PropertyDecorator`, `MethodDecorator`, and `ParameterDecorator`
- `TransportEncoder<T, U>(encode, decode)`
  - custom encoder/decoder for transport
  - `encode: (obj: T) => Awaitable<U>` - serialize function
  - `decode: (encoded: U) => Awaitable<T>` - deserialize function
  - supports async operations
  - works as `PropertyDecorator`, `MethodDecorator`, and `ParameterDecorator`

### Functions

- `initWorker(cls, ...args)`
  - creates a persistent worker and returns instance with `finalize(): Promise<void>` and `workerStatus(): WorkerStatus`
- `runInWorker(cls, cb, ...args)`
  - one-time worker execution with automatic finalize

### Types

- `WorkerStatus`
  - enum for worker status states
- `WorkerInstance<T>`
  - type for worker instance with `finalize()` and `workerStatus()` methods
- `WorkerEventName`
  - type for worker event names, matches `Worker.on()` event parameter
- `Awaitable<T>`
  - type for value that can be sync or async: `T | Promise<T>`
- `TransportTypeFactory`
  - type for transport type factory: `() => Class | [Class]`
- `TransportEncoderType<T, U>`
  - type for custom encoder/decoder object

## Notes

- Worker classes are still normal classes when instantiated directly via `new`.
- Only decorated methods go through the RPC channel.
- TypeScript decorators require `experimentalDecorators`.
- For `@TransportType()` to automatically infer types from TypeScript metadata, enable `emitDecoratorMetadata` in `tsconfig.json`.
- Transport decorators work with both `@WorkerMethod()` and `@WorkerCallback()`.
- Custom class transport preserves the prototype chain and method definitions.
