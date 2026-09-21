/**
 * Example 04: High-Throughput Batch Processing
 *
 * Demonstrates processing large volumes of messages or inputs in micro-batches
 * with concurrency control and promise pooling using BatchDispatcher.
 */

import { Vaelis, BatchDispatcher } from "../src";

async function main() {
  const vaelis = new Vaelis();
  // Create dispatcher with sliding window of 10 concurrent in-flight promises
  const dispatcher = new BatchDispatcher(vaelis.getClient(), 10);

  // Generate 50 sample customer queries
  const items = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    text:
      i % 5 === 0
        ? `Lethal cancellation message number ${i}`
        : i % 2 === 0
          ? `Product demo request inquiry number ${i}`
          : `General question about api pricing ${i}`,
  }));

  console.log(
    `🚀 Starting batch evaluation of ${items.length} items (Concurrency: 10)...\n`,
  );
  const startTime = performance.now();

  const results = await dispatcher.processPool(items, async (item) => {
    return vaelis.decide(item.text, [
      {
        id: "is_urgent",
        kind: "boolean",
        question: "Is this inquiry urgent?",
      },
    ]);
  });

  const totalTime = Math.round(performance.now() - startTime);

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("✅ Batch Processing Completed!");
  console.log(`- Total items: ${items.length}`);
  console.log(`- Success: ${successful}`);
  console.log(`- Failed: ${failed}`);
  console.log(`- Total Duration: ${totalTime}ms`);
  console.log(`- Average per item: ${(totalTime / items.length).toFixed(2)}ms`);
}

main().catch(console.error);
