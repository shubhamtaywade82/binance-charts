export class BinanceRateLimiter {
  private static queue: Promise<any> = Promise.resolve();
  private static MIN_INTERVAL_MS = 50; // 50ms spacing for Binance API

  public static execute<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T | null> {
    const taskPromise = this.queue.then(async () => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await new Promise((r) => setTimeout(r, this.MIN_INTERVAL_MS));
        try {
          const result = await fn();
          if (result !== undefined) return result;
        } catch (err: any) {
          const is429 = err?.status === 429 || err?.message?.includes("429");
          if (is429) {
            const backoff = Math.pow(2, attempt) * 1000;
            console.warn(`⏳ [Binance RateLimiter] HTTP 429 backoff ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
          } else {
            console.warn(`⚠️ [Binance API Warning]`, err?.message || err);
            if (attempt === maxRetries) return null;
          }
        }
      }
      return null;
    });

    this.queue = taskPromise.catch(() => {});
    return taskPromise;
  }
}
