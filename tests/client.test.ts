import { describe, it, expect } from "vitest";
import { VaelisClient, buildTypeSafeQuestions } from "../src/client";
import { DecisionRule } from "../src/types";

describe("VaelisClient Core & Transformers", () => {
  it("should transform decision rules to TypeSafe questions schema correctly", () => {
    const rules: DecisionRule[] = [
      { id: "is_urgent", kind: "boolean", question: "Is this urgent?" },
      {
        id: "priority_score",
        kind: "score",
        question: "Rate priority from 0 to 1",
      },
      {
        id: "category",
        kind: "choice",
        question: "Select intent",
        options: ["billing", "support", "sales"],
      },
    ];

    const questions = buildTypeSafeQuestions(rules);

    expect(questions.is_urgent.type).toBe("noul");
    expect(questions.is_urgent.instructions).toBe("Is this urgent?");

    expect(questions.priority_score.type).toBe("score");
    expect(questions.priority_score.criteria).toBeDefined();

    expect(questions.category.type).toBe("choice");
    expect(questions.category.criteria).toEqual({
      billing: "billing",
      support: "support",
      sales: "sales",
    });
  });

  it("should evaluate via deterministic fallback when no API key is provided", async () => {
    const client = new VaelisClient({
      provider: "typesafe",
      apiKey: "", // empty forces fallback
    });

    const questions = buildTypeSafeQuestions([
      { id: "check_danger", kind: "boolean", question: "Is it safe?" },
    ]);

    const result = await client.evaluate(
      "SELECT * FROM test_table;",
      questions,
    );

    expect(result.provider).toBe("deterministic");
    expect(result.answers.check_danger).toBeDefined();
    expect(result.answers.check_danger.type).toBe("noul");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("should enforce the 32,000 token context boundary (~128k characters)", async () => {
    const client = new VaelisClient();
    const giantState = "A".repeat(200_000); // 200k characters

    const questions = buildTypeSafeQuestions([
      { id: "length_check", kind: "boolean", question: "Check size" },
    ]);

    const result = await client.evaluate(giantState, questions);
    expect(result.provider).toBe("deterministic");
    expect(result.usage?.input_tokens).toBeLessThanOrEqual(32_000);
  });
});
