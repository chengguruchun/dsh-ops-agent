/**
 * V0.5 In-memory event bus (experimental skeleton)
 */

export type RuntimeEvent = {
  type: string;
  at: string;
  payload?: unknown;
};

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;

export class InMemoryEventBus {
  private handlers = new Map<string, Set<RuntimeEventHandler>>();
  private history: RuntimeEvent[] = [];
  readonly maxHistory: number;

  constructor(opts: { maxHistory?: number } = {}) {
    this.maxHistory = opts.maxHistory ?? 200;
  }

  on(type: string, handler: RuntimeEventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  onAny(handler: RuntimeEventHandler): () => void {
    return this.on('*', handler);
  }

  async emit(type: string, payload?: unknown): Promise<RuntimeEvent> {
    const event: RuntimeEvent = {
      type,
      at: new Date().toISOString(),
      payload,
    };
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    const specific = this.handlers.get(type);
    const any = this.handlers.get('*');
    const list = [...(specific ?? []), ...(any ?? [])];
    for (const h of list) {
      await h(event);
    }
    return event;
  }

  getHistory(): RuntimeEvent[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
  }
}
