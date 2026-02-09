import { DefineWorker, WorkerMethod, TransportType } from '../..';

export class Node {
  @TransportType(() => Node)
  next?: Node;

  constructor(public value: number) {}
}

@DefineWorker()
export class CircularRefWorker {
  @WorkerMethod()
  @TransportType(() => Node)
  async processNode(@TransportType(() => Node) node: Node): Promise<Node> {
    return new Node(node.value * 2);
  }
}
