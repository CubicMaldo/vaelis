/**
 * Example 05: Multi-Provider & Resilient Fallback Architecture
 *
 * Demonstrates Vaelis's 4-Tier Provider Resilience Pipeline:
 * Tier 1: TypeSafe AI Cloud (Jev model via API key)
 * Tier 2: Laya Local Edge (Open-weights local model on localhost:8000)
 * Tier 3: Google Gemini 2.5 Flash Fallback
 * Tier 4: Offline Deterministic Heuristic Engine (zero network, sub-5ms)
 */

import { Vaelis } from "../src";

async function main() {
  console.log("🌐 Multi-Provider Configuration Showcase\n");

  // Configuration 1: Production TypeSafe Cloud with Gemini Flash Fallback
  const cloudVaelis = new Vaelis({
    provider: "typesafe",
    apiKey: process.env.TYPESAFE_API_KEY || "demo-typesafe-key",
    geminiApiKey: process.env.GEMINI_API_KEY,
    fallback: "deterministic",
    fallbackOnAuthError: true,
  });

  // Configuration 2: Self-Hosted / Local Edge (Laya) with zero cloud dependency
  const edgeVaelis = new Vaelis({
    provider: "laya-local",
    endpoint: "http://localhost:8000/v1/systemone",
    fallback: "deterministic", // Falls back cleanly if local docker container is restarting
  });

  // Configuration 3: Zero-Config Offline Heuristic Engine
  const offlineVaelis = new Vaelis({
    provider: "deterministic",
  });

  console.log("1. Testing Zero-Config Offline Heuristic Engine...");
  const resultOffline = await offlineVaelis.decide(
    "Cancel my subscription immediately, I do not want this service anymore.",
    [
      {
        id: "is_cancellation",
        kind: "boolean",
        question: "Is user asking to cancel?",
      },
    ],
  );

  console.log(`- Provider used: ${resultOffline.provider}`);
  console.log(`- Evaluation latency: ${resultOffline.latencyMs}ms`);
  console.log(
    `- Decision: ${resultOffline.decisions["is_cancellation"].value} (Conf: ${resultOffline.decisions["is_cancellation"].confidence})`,
  );
  console.log(`- Token savings: ${resultOffline.tokenSavingsPercent}%\n`);

  console.log(
    "2. Testing Edge Configuration with auto-fallback to Deterministic...",
  );
  const resultEdge = await edgeVaelis.decide(
    "Can you give me a demo of your enterprise plan?",
    [
      {
        id: "is_sales_demo",
        kind: "boolean",
        question: "Is this a sales demo request?",
      },
    ],
  );

  console.log(`- Provider used: ${resultEdge.provider}`);
  console.log(`- Evaluation latency: ${resultEdge.latencyMs}ms`);
  console.log(
    `- Decision: ${resultEdge.decisions["is_sales_demo"].value} (Conf: ${resultEdge.decisions["is_sales_demo"].confidence})\n`,
  );

  console.log("3. Testing Cloud Configuration with automatic fallback pipeline...");
  const resultCloud = await cloudVaelis.decide(
    "Critical security patch update required immediately.",
    [
      {
        id: "is_security_urgent",
        kind: "boolean",
        question: "Is this security patch urgent?",
      },
    ],
  );

  console.log(`- Provider used: ${resultCloud.provider}`);
  console.log(`- Evaluation latency: ${resultCloud.latencyMs}ms`);
  console.log(
    `- Decision: ${resultCloud.decisions["is_security_urgent"].value} (Conf: ${resultCloud.decisions["is_security_urgent"].confidence})`,
  );
}

main().catch(console.error);
