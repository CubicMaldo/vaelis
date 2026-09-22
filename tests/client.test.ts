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

  it("should evaluate via custom LLM evaluator function", async () => {
    const client = new VaelisClient({
      fallback: {
        customEvaluator: async ({ state, questions }) => {
          expect(state).toBe("Test prompt");
          expect(questions.custom_rule).toBeDefined();
          return {
            custom_rule: {
              type: "choice",
              choice: "approved",
              confidence: 0.99,
            },
          };
        },
      },
    });

    const questions = buildTypeSafeQuestions([
      { id: "custom_rule", kind: "choice", question: "Approve or deny?" },
    ]);

    const result = await client.evaluate("Test prompt", questions);
    expect(result.provider).toBe("llm-fallback");
    expect(result.answers.custom_rule.choice).toBe("approved");
    expect(result.answers.custom_rule.confidence).toBe(0.99);
  });

  it("should evaluate via OpenAI-compatible endpoint with mock fetch", async () => {
    const originalFetch = globalThis.fetch;
    let interceptedUrl = "";
    let interceptedBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      interceptedUrl = url.toString();
      interceptedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        json: async () => ({
          model: "llama-3.3-70b-versatile",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answers: {
                    is_safe: {
                      type: "noul",
                      noul: 0.05,
                      confidence: 0.95,
                    },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 45, completion_tokens: 22 },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const client = new VaelisClient({
        fallback: {
          provider: "groq",
          apiKey: "gsk_test_123",
          model: "llama-3.3-70b-versatile",
        },
      });

      const questions = buildTypeSafeQuestions([
        { id: "is_safe", kind: "boolean", question: "Is this action safe?" },
      ]);

      const result = await client.evaluate("Run safety check", questions);

      expect(interceptedUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(interceptedBody.model).toBe("llama-3.3-70b-versatile");
      expect(result.provider).toBe("groq");
      expect(result.answers.is_safe.noul).toBe(0.05);
      expect(result.answers.is_safe.confidence).toBe(0.95);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should parse conversational markdown LLM responses properly", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: `Here is the JSON output you requested:\n\`\`\`json\n{\n  "answers": {\n    "test_rule": {\n      "type": "choice",\n      "choice": "opt_a",\n      "confidence": 0.96\n    }\n  }\n}\n\`\`\`\nHope this helps!`,
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 30 },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const client = new VaelisClient({
        fallback: {
          provider: "openai",
          apiKey: "sk-test",
        },
      });

      const questions = buildTypeSafeQuestions([
        { id: "test_rule", kind: "choice", question: "Pick option", options: ["opt_a", "opt_b"] },
      ]);

      const result = await client.evaluate("Evaluate me", questions);
      expect(result.provider).toBe("openai");
      expect(result.answers.test_rule.choice).toBe("opt_a");
      expect(result.answers.test_rule.confidence).toBe(0.96);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should handle Anthropic multi-block responses with thinking blocks", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => ({
          content: [
            { type: "thinking", thinking: "Analyzing the prompt..." },
            {
              type: "text",
              text: JSON.stringify({
                answers: {
                  is_billing: {
                    type: "noul",
                    noul: 0.99,
                    confidence: 0.99,
                  },
                },
              }),
            },
          ],
          usage: { input_tokens: 35, output_tokens: 25 },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const client = new VaelisClient({
        fallback: {
          provider: "anthropic",
          apiKey: "sk-ant-test",
        },
      });

      const questions = buildTypeSafeQuestions([
        { id: "is_billing", kind: "boolean", question: "Is this billing?" },
      ]);

      const result = await client.evaluate("I have an invoice issue", questions);
      expect(result.provider).toBe("anthropic");
      expect(result.answers.is_billing.noul).toBe(0.99);
      expect(result.answers.is_billing.confidence).toBe(0.99);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should fallback gracefully to deterministic engine when LLM call fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("Network connection refused");
    }) as typeof fetch;

    try {
      const client = new VaelisClient({
        fallback: {
          provider: "openai",
          apiKey: "sk-fake-key",
        },
      });

      const questions = buildTypeSafeQuestions([
        { id: "emergency_check", kind: "boolean", question: "Is it safe?" },
      ]);

      const result = await client.evaluate("DROP TABLE logs;", questions);

      expect(result.provider).toBe("deterministic");
      expect(result.answers.emergency_check).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
