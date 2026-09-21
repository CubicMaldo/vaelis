/**
 * Example 03: Fast-Path Intent & Cost Router
 *
 * Demonstrates 3-Tier Confidence Gating:
 * - HIGH_CONFIDENCE (>= 0.90): Deterministic Fast-Path execution (0 LLM tokens, ~95% cost reduction)
 * - MEDIUM_CONFIDENCE (0.65 - 0.89): Awaken heavy System 2 LLM (Gemini / Claude / GPT-4o)
 * - LOW_CONFIDENCE (< 0.65): Escalate to Human-in-the-Loop (HITL)
 */

import { Vaelis, DecisionRule } from "../src";

async function main() {
  const vaelis = new Vaelis({
    defaultPolicy: {
      highConfidenceThreshold: 0.9,
      mediumConfidenceThreshold: 0.65,
    },
  });

  const intentRules: DecisionRule[] = [
    {
      id: "detected_intent",
      kind: "choice",
      question: "Categorize the incoming customer ticket",
      options: [
        "refund_request",
        "cancel_subscription",
        "technical_question",
        "pricing_inquiry",
      ],
    },
    {
      id: "is_urgent",
      kind: "boolean",
      question:
        "Is the user expressing high distress, legal threats, or demanding immediate intervention?",
    },
  ];

  const queries = [
    {
      label: "Routine High-Confidence Request",
      text: "Hola, necesito cancelar mi suscripcion mensual antes de la proxima factura.",
    },
    {
      label: "Ambiguous Request",
      text: "Maybe I want to change something, or maybe not, tell me what you think.",
    },
    {
      label: "Hostile / High-Distress Request",
      text: "Son unos estafadores y ladrones, exijo mi reembolso inmediato o voy a presentar una denuncia!",
    },
  ];

  console.log("📊 3-Tier Intent & Cost Routing Simulation\n");

  for (const q of queries) {
    console.log(`=== Case: ${q.label} ===`);
    console.log(`Context: "${q.text}"`);

    const result = await vaelis.decide(q.text, intentRules);

    console.log(`• Routing Outcome: ${result.routing}`);
    console.log(`• Action: ${result.actionTaken}`);
    console.log(`• Confidence: ${(result.minConfidence * 100).toFixed(1)}%`);
    console.log(`• Token Savings: ${result.tokenSavingsPercent}%`);
    console.log(`• Latency: ${result.latencyMs}ms`);

    switch (result.routing) {
      case "HIGH_CONFIDENCE":
        console.log(
          "⚡ [FAST-PATH]: Executed deterministic action directly. 0 LLM tokens spent!",
        );
        break;
      case "MEDIUM_CONFIDENCE":
        console.log(
          "🧠 [SYSTEM 2]: Confidence is moderate. Awakening heavy reasoning model...",
        );
        break;
      case "LOW_CONFIDENCE":
      case "CROSS_CHECK_DISSONANCE":
      case "ADVERSARIAL_FREEZE":
        console.log("👤 [HITL]: Escalating to Human-in-the-Loop review queue.");
        break;
    }

    console.log();
  }
}

main().catch(console.error);
