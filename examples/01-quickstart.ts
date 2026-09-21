/**
 * Example 01: Quickstart (60 Seconds)
 *
 * Demonstrates basic initialization and evaluation with parallel rules.
 * Runs instantly using the built-in deterministic heuristic engine (no API key required).
 */

import { Vaelis } from "../src";

async function main() {
  console.log("🚀 Initializing Vaelis Gateway...");

  // Initialize Vaelis (uses deterministic fallback when no API key is passed)
  const vaelis = new Vaelis();

  const userPrompt =
    "Hey team, could you please send me a demo and the latest pricing table for enterprise?";

  console.log(`\nInput Context:\n"${userPrompt}"\n`);

  // Parallel System 1 Decision Rules
  const result = await vaelis.decide(userPrompt, [
    {
      id: "is_sales_lead",
      kind: "boolean",
      question:
        "Is the user inquiring about buying the product or seeing a demo?",
    },
    {
      id: "urgency_score",
      kind: "score",
      question:
        "Rate how urgent this inquiry is from 0.0 (casual) to 1.0 (immediate blocking need)",
    },
    {
      id: "inquiry_type",
      kind: "choice",
      question: "Classify user intent",
      options: ["sales_demo", "technical_support", "billing", "feedback"],
    },
  ]);

  console.log("⚡ Vaelis Evaluation Result:");
  console.log(`- Provider: ${result.provider}`);
  console.log(`- Latency: ${result.latencyMs}ms`);
  console.log(`- Routing: ${result.routing}`);
  console.log(`- Min Confidence: ${(result.minConfidence * 100).toFixed(1)}%`);
  console.log(`- Token Savings: ${result.tokenSavingsPercent}%`);
  console.log(`- Action Taken: ${result.actionTaken}`);

  console.log("\nDecisions Breakdown:");
  for (const [ruleId, dec] of Object.entries(result.decisions)) {
    console.log(
      `  • [${ruleId}]: value=${JSON.stringify(dec.value)}, confidence=${(dec.confidence * 100).toFixed(1)}%, accepted=${dec.accepted}`,
    );
  }
}

main().catch(console.error);
