import {
  EvaluatorConfig,
  DecisionRule,
  SystemOneProvider,
  TypeSafeQuestionPayload,
  TypeSafeJevResponse,
} from "./types";
import {
  resolveLLMFallbackConfig,
  evaluateWithUniversalLLM,
} from "./llm-adapter";

/**
 * Transforms standard Vaelis DecisionRules into the official TypeSafe AI questions schema.
 */
export function buildTypeSafeQuestions(
  rules: DecisionRule[],
): Record<string, TypeSafeQuestionPayload> {
  const questions: Record<string, TypeSafeQuestionPayload> = {};

  for (const rule of rules) {
    if (rule.kind === "boolean") {
      questions[rule.id] = {
        type: "noul",
        instructions: rule.question,
      };
    } else if (rule.kind === "score") {
      questions[rule.id] = {
        type: "score",
        instructions: rule.question,
        criteria:
          rule.options && rule.options.length > 0
            ? rule.options
            : [
                "0 - Low / Safe",
                "1 - Moderate / Attention Required",
                "2 - Critical / Urgent",
              ],
      };
    } else {
      // Choice kind (categorical up to 255 options)
      const criteria: Record<string, string> = {};
      const options =
        rule.options && rule.options.length > 0
          ? rule.options
          : ["option_1", "option_2", "other"];

      for (const opt of options) {
        criteria[opt] = opt.replace(/_/g, " ");
      }

      questions[rule.id] = {
        type: "choice",
        instructions: rule.question,
        criteria,
      };
    }
  }

  return questions;
}

/**
 * High-performance System 1 Client for Vaelis.
 * Connects directly to TypeSafe AI Cloud (Jev model), Laya (Local edge model),
 * Universal LLM Fallback (OpenAI, Groq, Anthropic, Gemini, DeepSeek, Ollama),
 * or deterministic heuristic engine.
 */
export class VaelisClient {
  public config: EvaluatorConfig;

  constructor(config: EvaluatorConfig = {}) {
    this.config = {
      provider: config.provider || "typesafe",
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      geminiApiKey: config.geminiApiKey,
      fallback: config.fallback ?? "llm",
      llmFallback: config.llmFallback,
      fallbackOnAuthError: config.fallbackOnAuthError ?? false,
      modelName: config.modelName || "jev-latest",
    };
  }

  /**
   * Evaluates unstructured context against questions dictionary directly.
   * Enforces 32k token context window (~128k chars) and 30s hard timeouts.
   */
  async evaluate(
    state: string,
    questions: Record<string, TypeSafeQuestionPayload>,
  ): Promise<
    TypeSafeJevResponse & { latencyMs: number; provider: SystemOneProvider }
  > {
    const startTime = performance.now();
    // Strict 32,000 token context boundary (~4 chars/token = 128,000 characters)
    const MAX_STATE_CHARS = 128_000;
    const cleanState =
      state.length > MAX_STATE_CHARS ? state.slice(0, MAX_STATE_CHARS) : state;

    // 1. TypeSafe AI Cloud Provider
    if (this.config.provider === "typesafe" && this.config.apiKey) {
      try {
        const cleanKey = this.config.apiKey.trim();
        const url = `${this.config.endpoint || "https://api.typesafe.ai"}/v1/systemone`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cleanKey}`,
          },
          body: JSON.stringify({
            model: this.config.modelName || "jev-latest",
            state: cleanState,
            questions,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        const latencyMs = Math.round(performance.now() - startTime);

        if (response.ok) {
          const data = (await response.json()) as TypeSafeJevResponse;
          return { ...data, latencyMs, provider: "typesafe" };
        } else {
          const errBody = await response.text();
          if (response.status === 401 || response.status === 403) {
            if (this.config.fallbackOnAuthError) {
              console.warn(
                `[VaelisClient] TypeSafe AI Authentication error (${response.status}). Proceeding to fallback pipeline due to fallbackOnAuthError=true...`,
              );
            } else {
              throw new Error(
                `TypeSafe AI Authentication error (${response.status}): ${errBody}`,
              );
            }
          } else {
            console.warn(
              `[VaelisClient] TypeSafe API error (${response.status}): ${errBody}. Falling back...`,
            );
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Authentication")) {
          throw err;
        }
        console.warn(
          `[VaelisClient] TypeSafe API unreachable (${err instanceof Error ? err.message : String(err)}). Switching to Fallback...`,
        );
      }
    }

    // 2. Laya Local Edge Provider
    if (this.config.provider === "laya-local") {
      try {
        const endpoint =
          this.config.endpoint || "http://localhost:8000/v1/systemone";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey
              ? { Authorization: `Bearer ${this.config.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: "laya-open-weight-v1",
            state: cleanState,
            questions,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          const data = (await response.json()) as TypeSafeJevResponse;
          const latencyMs = Math.round(performance.now() - startTime);
          return { ...data, latencyMs, provider: "laya-local" };
        }
      } catch {
        console.warn(
          "[VaelisClient] Laya local endpoint (localhost:8000) offline. Routing cleanly to configured fallback engine...",
        );
      }
    }

    // 3. Fallback Pipeline: Universal LLM (OpenAI, Groq, Anthropic, Gemini, DeepSeek, etc.) or Deterministic
    if (this.config.fallback !== "deterministic") {
      const llmConfig = resolveLLMFallbackConfig(this.config);
      if (llmConfig) {
        try {
          const llmResult = await evaluateWithUniversalLLM(
            llmConfig,
            cleanState,
            questions,
            startTime,
          );
          if (llmResult) {
            return llmResult;
          }
        } catch (llmErr) {
          console.warn(
            `[VaelisClient] Universal LLM fallback error (${llmErr instanceof Error ? llmErr.message : String(llmErr)}). Switching to Deterministic Heuristic Engine...`,
          );
        }
      }
    }

    // Final Deterministic Heuristic Engine
    return this.evaluateDeterministicFallback(cleanState, questions, startTime);
  }

  /**
   * High-level query taking DecisionRules instead of raw questions dictionary.
   */
  async query(
    context: string,
    rules: DecisionRule[],
  ): Promise<{
    rawResponse: TypeSafeJevResponse;
    httpLatencyMs: number;
    provider: SystemOneProvider;
  }> {
    const questions = buildTypeSafeQuestions(rules);
    const result = await this.evaluate(context, questions);
    return {
      rawResponse: {
        model: result.model,
        answers: result.answers,
        usage: result.usage,
      },
      httpLatencyMs: result.latencyMs,
      provider: result.provider,
    };
  }

  /**
   * Deterministic Heuristic Fallback Engine
   */
  private async evaluateDeterministicFallback(
    state: string,
    questions: Record<string, TypeSafeQuestionPayload>,
    startTime: number,
  ): Promise<
    TypeSafeJevResponse & { latencyMs: number; provider: SystemOneProvider }
  > {
    const lower = state.toLowerCase();
    const answers: TypeSafeJevResponse["answers"] = {};

    for (const [id, q] of Object.entries(questions)) {
      if (q.type === "noul") {
        const isNegative =
          lower.includes("ladron") ||
          lower.includes("estafador") ||
          lower.includes("cancel") ||
          lower.includes("denuncia") ||
          lower.includes("amenaza") ||
          lower.includes("drop") ||
          lower.includes("rm -rf");
        const isPositive =
          lower.includes("gracias") ||
          lower.includes("demo") ||
          lower.includes("precio") ||
          lower.includes("select") ||
          lower.includes("consulta");
        const noulVal = isNegative ? 0.95 : isPositive ? 0.08 : 0.62;
        answers[id] = {
          type: "noul",
          noul: noulVal,
          probability: noulVal,
          confidence: Math.round(Math.max(noulVal, 1 - noulVal) * 100) / 100,
        };
      } else if (q.type === "score") {
        const isUrgent =
          lower.includes("urgent") ||
          lower.includes("5 pm") ||
          lower.includes("inmediato") ||
          lower.includes("crítico") ||
          lower.includes("critico");
        const score = isUrgent ? 0.95 : 0.4;
        answers[id] = {
          type: "score",
          score,
          confidence: 0.92,
        };
      } else {
        const opts = Array.isArray(q.criteria)
          ? q.criteria
          : q.criteria
            ? Object.keys(q.criteria)
            : ["option_1", "option_2"];
        let chosen = opts[0];
        if (
          lower.includes("reembolso") ||
          lower.includes("cargo no reconocido") ||
          lower.includes("fraud")
        ) {
          chosen =
            opts.find(
              (o) =>
                o.includes("unauthorized") ||
                o.includes("refund") ||
                o.includes("charge") ||
                o.includes("billing"),
            ) || opts[0];
        } else if (lower.includes("cancel")) {
          chosen = opts.find((o) => o.includes("cancel")) || opts[0];
        } else if (lower.includes("pregunta") || lower.includes("?")) {
          chosen =
            opts.find(
              (o) =>
                o.toLowerCase().includes("pregunta") ||
                o.toLowerCase().includes("support") ||
                o.toLowerCase().includes("inquiry"),
            ) || opts[0];
        }
        answers[id] = {
          type: "choice",
          choice: chosen,
          confidence: 0.91,
        };
      }
    }

    const latencyMs = Math.round(performance.now() - startTime);

    return {
      model: "deterministic-heuristic-v1",
      answers,
      usage: {
        input_tokens: Math.round(state.length / 4),
        output_tokens: Object.keys(questions).length * 4,
      },
      latencyMs,
      provider: "deterministic",
    };
  }
}
