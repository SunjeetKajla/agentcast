/** At most `size` tasks at once; the rest queue in order. Subscription logins have usage limits (PRD §9.9). */
export class Pool {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
