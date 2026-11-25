/** Runs one background pass at a time and waits for an in-flight pass on shutdown. */
export class PollingLoop {
  private timer?: NodeJS.Timeout;

  private cycle?: Promise<void>;

  private stopped = false;

  constructor(
    private readonly tick: () => Promise<number>,
    private readonly onError: (error: unknown) => void,
  ) {}

  start() {
    if (!this.timer) {
      this.schedule(0);
    }
  }

  private schedule(delay: number) {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.cycle = this.tick().then(
        (next) => this.schedule(next),
        (error) => {
          this.onError(error);
          this.schedule(1000);
        },
      );
    }, delay);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.cycle;
  }
}
