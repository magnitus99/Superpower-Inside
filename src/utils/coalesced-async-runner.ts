export class CoalescedAsyncRunner {
  private running: Promise<void> | null = null;
  private pending = false;

  constructor(private readonly operation: () => Promise<void>) {}

  run(): Promise<void> {
    this.pending = true;
    if (!this.running) {
      this.running = this.drain();
    }
    return this.running;
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        this.pending = false;
        await this.operation();
      }
    } finally {
      this.running = null;
    }
  }
}
