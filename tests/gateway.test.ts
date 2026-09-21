import { describe, it, expect } from "vitest";
import { VaelisGateway } from "../src/gateway";
import { VaelisClient } from "../src/client";
import { DecisionRule } from "../src/types";

describe("VaelisGateway Decision & Confidence Routing", () => {
  it("should route to HIGH_CONFIDENCE when all rules exceed the threshold", async () => {
    const client = new VaelisClient();
    // Mock client to return high confidence
    client.query = async () => ({
      rawResponse: {
        model: "mock",
        answers: {
          intent: {
            type: "choice",
            choice: "sales",
            confidence: 0.95,
          },
        },
      },
      httpLatencyMs: 20,
      provider: "typesafe",
    });

    const gateway = new VaelisGateway(client, {
      highConfidenceThreshold: 0.9,
      mediumConfidenceThreshold: 0.65,
    });

    const rules: DecisionRule[] = [
      {
        id: "intent",
        kind: "choice",
        question: "Select intent",
        options: ["sales", "support"],
      },
    ];

    const result = await gateway.evaluate("Tell me about pricing", rules);

    expect(result.routing).toBe("HIGH_CONFIDENCE");
    expect(result.tokenSavingsPercent).toBe(100);
    expect(result.decisions.intent.accepted).toBe(true);
    expect(result.escalatedToHuman).toBe(false);
  });

  it("should route to MEDIUM_CONFIDENCE (awaken System 2) when confidence is moderate", async () => {
    const client = new VaelisClient();
    client.query = async () => ({
      rawResponse: {
        model: "mock",
        answers: {
          ambiguous_rule: {
            type: "choice",
            choice: "maybe",
            confidence: 0.75,
          },
        },
      },
      httpLatencyMs: 25,
      provider: "typesafe",
    });

    const gateway = new VaelisGateway(client, {
      highConfidenceThreshold: 0.9,
      mediumConfidenceThreshold: 0.65,
    });

    const rules: DecisionRule[] = [
      { id: "ambiguous_rule", kind: "choice", question: "Is this clear?" },
    ];

    const result = await gateway.evaluate("Some ambiguous text", rules);

    expect(result.routing).toBe("MEDIUM_CONFIDENCE");
    expect(result.actionTaken).toBe("AWAKEN_HEAVY_LLM_SYSTEM_2");
    expect(result.tokenSavingsPercent).toBe(0);
  });

  it("should escalate to HITL on low confidence", async () => {
    const client = new VaelisClient();
    client.query = async () => ({
      rawResponse: {
        model: "mock",
        answers: {
          obscure_rule: {
            type: "choice",
            choice: "unknown",
            confidence: 0.45,
          },
        },
      },
      httpLatencyMs: 15,
      provider: "typesafe",
    });

    const gateway = new VaelisGateway(client, {
      highConfidenceThreshold: 0.9,
      mediumConfidenceThreshold: 0.65,
    });

    const rules: DecisionRule[] = [
      { id: "obscure_rule", kind: "choice", question: "Recognize language" },
    ];

    const result = await gateway.evaluate("X79fks!#$", rules);

    expect(result.routing).toBe("LOW_CONFIDENCE");
    expect(result.escalatedToHuman).toBe(true);
    expect(result.actionTaken).toBe("ESCALATED_TO_HUMAN");
  });
});
