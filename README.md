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

## API

- `DefineWorker(options?)`
  - `options.filePath?`: worker file path override (optional, auto-inferred by default)
  - `options.id?`: custom class registration ID (optional)
- `WorkerMethod()`
  - marks a method to execute on worker thread
- `WorkerCallback()`
  - marks a method to execute on main thread when called from worker
- `initWorker(cls, ...args)`
  - creates a persistent worker and returns instance with `finalize(): Promise<void>`
- `runInWorker(cls, cb, ...args)`
  - one-time worker execution with automatic finalize

## Notes

- Worker classes are still normal classes when instantiated directly via `new`.
- Only decorated methods go through the RPC channel.
- TypeScript decorators require `experimentalDecorators`.
