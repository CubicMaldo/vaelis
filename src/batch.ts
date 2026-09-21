import { VaelisClient } from "./client";

export class BatchDispatcher {
  private client: VaelisClient;
  private concurrency: number;

  constructor(client: VaelisClient, concurrency: number = 50) {
    this.client = client;
    this.concurrency = concurrency;
  }

  /**
   * Processes a large volume of items concurrently in micro-batches with high throughput.
   * Maintains a sliding window of at most `concurrency` in-flight promises.
   * Resilient against individual item rejections.
   */
  async processPool<T, R>(
    items: T[],
    evaluateFn: (item: T) => Promise<R>,
  ): Promise<Array<{ success: boolean; result?: R; error?: unknown }>> {
    const results: Array<{ success: boolean; result?: R; error?: unknown }> =
      new Array(items.length);
    const executing = new Set<Promise<void>>();

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const p = Promise.resolve()
        .then(() => evaluateFn(item))
        .then((res) => {
          results[index] = { success: true, result: res };
        })
        .catch((err) => {
          results[index] = { success: false, error: err };
        })
        .finally(() => {
          executing.delete(p);
        });

      executing.add(p);

      if (executing.size >= this.concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  getClient(): VaelisClient {
    return this.client;
  }
}
