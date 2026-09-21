export type DecisionKind = "choice" | "score" | "boolean";

// Multi-Provider Support (Cloud, Local Edge, Fallback & Offline Heuristic)
export type SystemOneProvider =
  | "typesafe"
  | "gemini-flash"
  | "laya-local"
  | "deterministic"
  | "static-guardrail";

export interface EvaluatorConfig {
  /** Provider engine to evaluate rules with. Defaults to 'typesafe'. */
  provider?: SystemOneProvider;
  /** Custom endpoint URL (e.g. 'http://localhost:8000/v1/systemone' for Laya edge model). */
  endpoint?: string;
  /** API key for TypeSafe Cloud or secured edge endpoint. */
  apiKey?: string;
  /** Optional Google Gemini API key for zero-friction fallback. */
  geminiApiKey?: string;
  /** Fallback strategy if primary provider is unavailable. Defaults to 'gemini-flash'. */
  fallback?: "gemini-flash" | "deterministic";
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
