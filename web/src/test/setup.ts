// The store's atoms are persisted, and `createJSONStorage(() => localStorage)`
// touches localStorage as soon as the module is imported - so a test that only
// wants to check a migration still needs one to exist.
//
// A hand-written Map beats pulling in jsdom for this: it is the whole API these
// tests use, and it can be cleared between tests without tearing down a DOM.
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
}

globalThis.localStorage = new MemoryStorage();
