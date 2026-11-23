type Listener<T> = (value: T) => void;

/** 极简的类型安全事件发射器。 */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(value);
      } catch (error) {
        console.error('[emitter] listener failed', error);
      }
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
