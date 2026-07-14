export class CoalescedAsyncRunner {
  private running: Promise<void> | null = null;

  constructor(private readonly operation: () => Promise<void>) {}

  run(): Promise<void> {
    if (!this.running) {
      this.running = this.operation().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  isRunning(): boolean {
    return this.running !== null;
  }
}
