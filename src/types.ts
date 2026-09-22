export type DecisionKind = "choice" | "score" | "boolean";

// Multi-Provider Support (Cloud, Local Edge, Universal LLM Fallback & Offline Heuristic)
export type SystemOneProvider =
  | "typesafe"
  | "gemini-flash"
  | "openai"
  | "groq"
  | "anthropic"
  | "deepseek"
  | "mistral"
  | "openrouter"
  | "ollama"
  | "llm-fallback"
  | "laya-local"
  | "deterministic"
  | "static-guardrail";

export type SupportedLLMProvider =
  | "openai"
  | "groq"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "mistral"
  | "openrouter"
  | "ollama"
  | "custom";

export interface LLMFallbackConfig {
  /** LLM provider preset or 'custom'. Defaults to 'openai' or inferred from baseUrl/env. */
  provider?: SupportedLLMProvider;
  /** API key for the LLM provider. */
  apiKey?: string;
  /** Model identifier (e.g. 'gpt-4o-mini', 'llama-3.3-70b-versatile', 'claude-3-5-haiku-20241022', 'gemini-2.5-flash'). */
  model?: string;
  /** Custom API base URL (e.g. 'https://api.groq.com/openai/v1', 'http://localhost:11434/v1', 'https://api.deepseek.com/v1'). */
  baseUrl?: string;
  /** Custom request headers if needed. */
  headers?: Record<string, string>;
  /** Optional custom evaluation function for complete control. */
  customEvaluator?: (params: {
    state: string;
    questions: Record<string, TypeSafeQuestionPayload>;
  }) => Promise<TypeSafeJevResponse["answers"]>;
}

export interface EvaluatorConfig {
  /** Provider engine to evaluate rules with. Defaults to 'typesafe'. */
  provider?: SystemOneProvider;
  /** Custom endpoint URL (e.g. 'http://localhost:8000/v1/systemone' for Laya edge model). */
  endpoint?: string;
  /** API key for TypeSafe Cloud or secured edge endpoint. */
  apiKey?: string;
  /** 
   * @deprecated Use `fallbackApiKey` or `llmFallback` config instead.
   */
  geminiApiKey?: string;
  /**
   * Fallback strategy:
   * - "deterministic": offline heuristic engine (0 cost, no network).
   * - "llm": generic LLM fallback (uses llmFallback config or auto-detected env keys).
   * - SupportedLLMProvider: Direct provider string (e.g. 'gemini', 'openai').
   * - LLMFallbackConfig object: full configuration for any LLM.
   * @deprecated The string "gemini-flash" is deprecated, use "gemini" instead.
   */
  fallback?: "gemini-flash" | "deterministic" | "llm" | SupportedLLMProvider | LLMFallbackConfig;
  /** Explicit API key for the fallback provider. */
  fallbackApiKey?: string;
  /** Explicit LLM fallback configuration. */
  llmFallback?: LLMFallbackConfig;
  /** Whether to automatically fallback when authentication fails. */
  fallbackOnAuthError?: boolean;
  /** Model identifier. Defaults to 'jev-latest' for TypeSafe. */
  modelName?: string;
}

export interface DecisionRule {
  /** Unique identifier for the decision rule. */
  id: string;
  /** Type of decision: 'choice' (categorical), 'score' (0.0 to 1.0 continuous), or 'boolean' (true/false). */
  kind: DecisionKind;
  /** Natural language evaluation prompt or criteria. */
  question: string;
  /** Possible categorical options (required if kind === 'choice'). */
  options?: string[];
  /** Minimum calibrated confidence required to accept decision (defaults to policy threshold). */
  minConfidence?: number;
  /** Optional rule description for documentation or telemetry. */
  description?: string;
}

export interface DecisionResult {
  ruleId: string;
  value: string | number | boolean;
  confidence: number; // 0.00 to 1.00 calibrated probability
  accepted: boolean;
  reasoning?: string;
  alternatives?: Array<{
    value: string | number | boolean;
    confidence: number;
  }>;
}

export interface GatewayPolicy {
  /** Confidence >= highConfidenceThreshold -> Direct deterministic execution (0 LLM tokens, ~95% savings) */
  highConfidenceThreshold: number; // default: 0.90
  /** Confidence between medium and high -> Awaken heavy reasoning model (System 2) */
  mediumConfidenceThreshold: number; // default: 0.65
}

export type RoutingOutcome =
  | "HIGH_CONFIDENCE"
  | "MEDIUM_CONFIDENCE"
  | "LOW_CONFIDENCE"
  | "STATIC_GUARDRAIL_BLOCK"
  | "CROSS_CHECK_DISSONANCE"
  | "ADVERSARIAL_FREEZE";

export type RoutingTier = "HIGH" | "MEDIUM" | "ESCALATE";

export interface GuardrailDecision {
  ruleId: string;
  value: unknown;
  confidence: number;
  accepted: boolean;
}

export interface SecurityVerdict {
  /** Whether the action or tool invocation is authorized to execute. */
  allowed: boolean;
  /** Routing outcome classification. */
  routing: RoutingOutcome;
  /** Calibrated confidence score of the decision. */
  minConfidence: number;
  /** Evaluation latency in milliseconds. */
  latencyMs: number;
  /** Human-readable label of the verdict action. */
  actionTaken: string;
  /** Evaluated guardrail decisions breakdown. */
  decisions: Record<string, GuardrailDecision>;
}

export interface ToolInterceptParams {
  /** The command, SQL query, or function call payload. */
  command: string;
  /** The prompt, user request, or context leading to this execution. */
  context: string;
  /** Execution environment metadata. */
  environment: {
    isProduction: boolean;
    role: string;
    affectedEntitiesCount?: number;
  };
}

export interface TypeSafeQuestionPayload {
  type: "choice" | "noul" | "score";
  instructions: string;
  criteria?: Record<string, string> | string[];
}

export interface TypeSafeJevResponse {
  model: string;
  answers: Record<
    string,
    {
      type: "choice" | "noul" | "score";
      choice?: string;
      noul?: number;
      probability?: number;
      score?: number;
      confidence?: number;
      legend?: Record<string, string>;
      probabilities?: Record<string, number>;
    }
  >;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: string;
}

export interface VaelisEvaluationResult {
  /** Map of evaluated decision results keyed by rule ID. */
  decisions: Record<string, DecisionResult>;
  /** Minimum calibrated confidence among all evaluated rules. */
  minConfidence: number;
  /** Average calibrated confidence across rules. */
  avgConfidence: number;
  /** Three-tier confidence routing destination. */
  routing: RoutingOutcome;
  /** Overall processing latency in milliseconds. */
  latencyMs: number;
  /** HTTP / network roundtrip latency in milliseconds. */
  httpLatencyMs: number;
  /** Estimated token reduction percentage compared to full LLM invocation. */
  tokenSavingsPercent: number;
  /** Estimated USD savings compared to heavy LLM (e.g. GPT-4o / Claude 3.5 Sonnet). */
  costSavingsEstimateUsd: number;
  /** Deterministic action label applied by the gateway. */
  actionTaken: string;
  /** Whether the evaluation was escalated to Human-in-the-Loop (HITL). */
  escalatedToHuman: boolean;
  /** Raw response from the underlying System 1 engine. */
  rawJevResponse: TypeSafeJevResponse;
  /** Provider that successfully handled the evaluation. */
  provider?: SystemOneProvider;
}
