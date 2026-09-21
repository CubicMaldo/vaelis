import { describe, it, expect } from "vitest";
import { BatchDispatcher } from "../src/batch";
import { VaelisClient } from "../src/client";

describe("BatchDispatcher Concurrency & Resilience", () => {
  it("should process items within maximum concurrency sliding window", async () => {
    const client = new VaelisClient();
    const dispatcher = new BatchDispatcher(client, 5);

    let activeCount = 0;
    let maxObservedActive = 0;

    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const results = await dispatcher.processPool(items, async (item) => {
      activeCount++;
      if (activeCount > maxObservedActive) {
        maxObservedActive = activeCount;
      }
      // Small artificial delay to simulate async work
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCount--;
      return item * 2;
    });

    expect(maxObservedActive).toBeLessThanOrEqual(5);
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0].result).toBe(2);
    expect(results[9].result).toBe(20);
  });

  it("should isolate individual item errors without failing the whole pool", async () => {
    const client = new VaelisClient();
    const dispatcher = new BatchDispatcher(client, 3);

    const items = ["ok1", "fail", "ok2"];

    const results = await dispatcher.processPool(items, async (item) => {
      if (item === "fail") {
        throw new Error("Item processing error");
      }
      return item.toUpperCase();
    });

    expect(results[0].success).toBe(true);
    expect(results[0].result).toBe("OK1");

    expect(results[1].success).toBe(false);
    expect((results[1].error as Error).message).toBe("Item processing error");

    expect(results[2].success).toBe(true);
    expect(results[2].result).toBe("OK2");
  });
});
