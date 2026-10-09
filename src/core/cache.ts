interface Entry {
  key: string;
  prefix: string;
  suffix: string;
  text: string;
}

/**
 * Caché LRU de sugerencias. Además de aciertos exactos, permite "escribir a través"
 * de una sugerencia: si el usuario teclea justo lo que se le sugirió, se devuelve
 * el resto sin hacer otra petición.
 */
export class CompletionCache {
  private entries: Entry[] = [];

  constructor(private readonly capacity = 64) {}

  get(key: string, prefix: string, suffix: string): string | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.key !== key || e.suffix !== suffix) continue;
      if (e.prefix === prefix) return this.touch(i, e.text);
      if (prefix.length > e.prefix.length && prefix.startsWith(e.prefix)) {
        const typed = prefix.slice(e.prefix.length);
        if (typed.length < e.text.length && e.text.startsWith(typed)) {
          return this.touch(i, e.text.slice(typed.length));
        }
      }
    }
    return undefined;
  }

  set(key: string, prefix: string, suffix: string, text: string): void {
    this.entries = this.entries.filter((e) => !(e.key === key && e.prefix === prefix && e.suffix === suffix));
    this.entries.push({ key, prefix, suffix, text });
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  clear(): void {
    this.entries = [];
  }

  private touch(i: number, result: string): string {
    const [e] = this.entries.splice(i, 1);
    this.entries.push(e);
    return result;
  }
}
