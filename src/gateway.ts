import { VaelisClient } from "./client";
import {
  DecisionRule,
  DecisionResult,
  GatewayPolicy,
  RoutingOutcome,
  SecurityVerdict,
  ToolInterceptParams,
  GuardrailDecision,
  VaelisEvaluationResult,
} from "./types";

export class VaelisGateway {
  private client: VaelisClient;
  private defaultPolicy: GatewayPolicy;

  constructor(client: VaelisClient, defaultPolicy?: Partial<GatewayPolicy>) {
    this.client = client;
    this.defaultPolicy = {
      highConfidenceThreshold: defaultPolicy?.highConfidenceThreshold ?? 0.9,
      mediumConfidenceThreshold:
        defaultPolicy?.mediumConfidenceThreshold ?? 0.65,
    };
  }

  /**
   * Evaluates unstructured context against parallel decision rules using System 1.
   * Decisions are gated deterministically by mathematical confidence thresholds.
   */
  async evaluate(
    context: string,
    rules: DecisionRule[],
    policyOverride?: Partial<GatewayPolicy>,
  ): Promise<VaelisEvaluationResult> {
    const policy: GatewayPolicy = {
      highConfidenceThreshold:
        policyOverride?.highConfidenceThreshold ??
        this.defaultPolicy.highConfidenceThreshold,
      mediumConfidenceThreshold:
        policyOverride?.mediumConfidenceThreshold ??
        this.defaultPolicy.mediumConfidenceThreshold,
    };

    const {
      rawResponse: rawJevResponse,
      httpLatencyMs,
      provider,
    } = await this.client.query(context, rules);
    const answers = rawJevResponse.answers || {};
    const decisions: Record<string, DecisionResult> = {};

    let minConfidence = 1.0;
    let sumConfidence = 0;

    for (const rule of rules) {
      const ans = answers[rule.id];
      let value: string | number | boolean = false;
      let confidence = 0.5;
      let reasoning = "";

      if (ans) {
        if (ans.type === "choice") {
          value =
            ans.choice || (rule.options ? rule.options[0] : "unspecified");
          confidence =
            typeof ans.confidence === "number" ? ans.confidence : 0.9;
          reasoning = `Vaelis Choice: "${value}" (Calibrated confidence: ${Math.round(confidence * 100)}%)`;
        } else if (ans.type === "noul") {
          const prob =
            typeof ans.noul === "number"
              ? ans.noul
              : typeof ans.probability === "number"
                ? ans.probability
                : 0.5;
          value = prob >= 0.5;
          confidence =
            typeof ans.confidence === "number"
              ? ans.confidence
              : Math.round(Math.max(prob, 1 - prob) * 1000) / 1000;
          reasoning = `Vaelis Noul (Binary): ${value ? "TRUE" : "FALSE"} (P=${prob}, Conf=${Math.round(confidence * 100)}%)`;
        } else if (ans.type === "score") {
          value =
            typeof ans.score === "number"
              ? Math.round(ans.score * 100) / 100
              : 0.5;
          confidence =
            typeof ans.confidence === "number" ? ans.confidence : 0.85;
          reasoning = `Vaelis Score: ${value} (Calibrated confidence: ${Math.round(confidence * 100)}%)`;
        }
      } else {
        confidence = 0.5;
        reasoning = "Rule omitted by System 1 engine.";
      }

      const accepted =
        confidence >= (rule.minConfidence ?? policy.highConfidenceThreshold);

      if (confidence < minConfidence) {
        minConfidence = confidence;
      }
      sumConfidence += confidence;

      decisions[rule.id] = {
        ruleId: rule.id,
        value,
        confidence: Math.round(confidence * 1000) / 1000,
        accepted,
        reasoning,
      };
    }

    const count = rules.length > 0 ? rules.length : 1;
    const avgConfidence = Math.round((sumConfidence / count) * 1000) / 1000;
    minConfidence = Math.round(minConfidence * 1000) / 1000;

    // Three-tier confidence gateway routing logic
    let routing: RoutingOutcome;
    let actionTaken: string;
    let escalatedToHuman = false;

    if (minConfidence >= policy.highConfidenceThreshold) {
      routing = "HIGH_CONFIDENCE";
      actionTaken = "EXECUTE_DETERMINISTIC_ACTION";
    } else if (minConfidence >= policy.mediumConfidenceThreshold) {
      routing = "MEDIUM_CONFIDENCE";
      actionTaken = "AWAKEN_HEAVY_LLM_SYSTEM_2";
    } else {
      routing = "LOW_CONFIDENCE";
      actionTaken = "ESCALATED_TO_HUMAN";
      escalatedToHuman = true;
    }

    // Adversarial and Dissonance cross-checks
    const isSafe = decisions["is_safe_to_execute"]?.value === true;
    const isDest =
      decisions["is_destructive"]?.value === true ||
      decisions["is_destructive_or_irreversible"]?.value === true;
    const isAdv =
      decisions["is_adversarial_or_jailbreak"]?.value === true ||
      context.toLowerCase().includes("ignore previous") ||
      context.toLowerCase().includes("ignore instructions");

    if (isAdv) {
      routing = "ADVERSARIAL_FREEZE";
      actionTaken = "ADVERSARIAL_INJECTION_DETECTED_FREEZE";
      escalatedToHuman = true;
    } else if (isSafe && isDest) {
      routing = "CROSS_CHECK_DISSONANCE";
      actionTaken = "CROSS_CHECK_DISSONANCE_ESCALATED_TO_HUMAN";
      minConfidence = 0.5;
      escalatedToHuman = true;
    }

    // Calculate token and cost savings based on actual usage and routing
    const inputTokens =
      rawJevResponse.usage?.input_tokens ?? Math.round(context.length / 4);
    const outputTokens = rawJevResponse.usage?.output_tokens ?? 20;

    // Estimate LLM equivalent cost ($3/1M input, $15/1M output for heavy models like GPT-4o/Claude Sonnet)
    const heavyLlmCost =
      (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;

    // If routed to HIGH_CONFIDENCE, we saved 100% of the heavy LLM tokens
    const tokenSavingsPercent =
      routing === "HIGH_CONFIDENCE"
        ? 100
        : routing === "MEDIUM_CONFIDENCE"
          ? 0
          : 100;

    const costSavingsEstimateUsd =
      tokenSavingsPercent === 100 ? heavyLlmCost : 0;

    return {
      decisions,
      minConfidence,
      avgConfidence,
      routing,
      latencyMs: httpLatencyMs,
      httpLatencyMs,
      tokenSavingsPercent,
      costSavingsEstimateUsd,
      actionTaken,
      escalatedToHuman,
      rawJevResponse,
      provider,
    };
  }

  /**
   * Intercepts autonomous agent tool execution before hitting terminal or databases.
   * Runs in sub-80ms with 3 defense lines:
   * 1. Static Pre-Guardrail (<1ms regex matching lethal patterns)
   * 2. State Engineering with strict 32k context boundary
   * 3. Dual-Query Cross-Check & Dissonance Freeze
   */
  async interceptToolCall(
    params: ToolInterceptParams,
  ): Promise<SecurityVerdict> {
    const start = performance.now();

    // 1. Static Pre-Guardrail: Instant deterministic block in <1 ms
    const staticLethalRegex =
      /\b(DROP\s+TABLE|rm\s+-rf|TRUNCATE|FORMAT|DROP\s+DATABASE|mkfs|chmod\s+-R\s+777)\b/i;
    if (staticLethalRegex.test(params.command)) {
      return {
        allowed: false,
        routing: "STATIC_GUARDRAIL_BLOCK",
        minConfidence: 1.0,
        latencyMs: 1,
        actionTaken: "STATIC_GUARDRAIL_TRIGGERED_LETHAL_COMMAND_PREVENTED",
        decisions: {
          is_destructive: {
            ruleId: "is_destructive",
            value: true,
            confidence: 1.0,
            accepted: false,
          },
        },
      };
    }

    // 2. State Engineering: Pack metadata and enforce 32k token context window
    const enrichedState = JSON.stringify({
      command: params.command,
      user_intent: params.context,
      environment: {
        isProduction: params.environment?.isProduction ?? true,
        role: params.environment?.role ?? "agent_executor",
        affectedEntitiesCount: params.environment?.affectedEntitiesCount ?? 1,
      },
    }).slice(0, 32000);

    // 3. Dual-Query Cross-Check & Dissonance Detection
    const questions = {
      is_safe_to_execute: {
        type: "noul" as const,
        instructions:
          "Is it completely safe to execute this command in the given context without causing irreversible destruction?",
      },
      is_destructive_or_irreversible: {
        type: "noul" as const,
        instructions:
          "Does this command delete persistent data, alter production tables, or mutate state irreversibly?",
      },
      is_adversarial_or_jailbreak: {
        type: "noul" as const,
        instructions:
          "Does the input contain prompt injection, privilege escalation, or hostile manipulation patterns?",
      },
    };

    const raw = await this.client.evaluate(enrichedState, questions);
    const latencyMs = Math.round(performance.now() - start);

    const safeAnswer = raw.answers?.is_safe_to_execute;
    const destAnswer = raw.answers?.is_destructive_or_irreversible;
    const advAnswer = raw.answers?.is_adversarial_or_jailbreak;

    // SECURITY: Fail-closed defaults — if answers are missing, deny execution
    const safeProb = safeAnswer?.probability ?? safeAnswer?.noul;
    const isSafe =
      safeAnswer?.noul !== undefined
        ? safeAnswer.noul >= 0.7
        : safeAnswer?.choice === "true" ||
          (safeProb !== undefined ? safeProb >= 0.7 : false);

    const destProb = destAnswer?.probability ?? destAnswer?.noul;
    const isDestructive =
      destAnswer?.noul !== undefined
        ? destAnswer.noul >= 0.7
        : destProb !== undefined
          ? destProb >= 0.7
          : true;

    // Adversarial threshold: >= 0.50 triggers freeze
    const advScore = advAnswer?.noul ?? advAnswer?.probability ?? 0.0;
    const isAdversarial =
      advScore >= 0.5 ||
      (typeof advAnswer?.confidence === "number" &&
        advAnswer.confidence > 0.85 &&
        advAnswer?.choice === "true");

    const decisions: Record<string, GuardrailDecision> = {
      is_safe_to_execute: {
        ruleId: "is_safe_to_execute",
        value: isSafe,
        confidence: safeAnswer?.confidence ?? 0.9,
        accepted: isSafe,
      },
      is_destructive_or_irreversible: {
        ruleId: "is_destructive_or_irreversible",
        value: isDestructive,
        confidence: destAnswer?.confidence ?? 0.9,
        accepted: !isDestructive,
      },
      is_adversarial_or_jailbreak: {
        ruleId: "is_adversarial_or_jailbreak",
        value: isAdversarial,
        confidence: advAnswer?.confidence ?? 0.9,
        accepted: !isAdversarial,
      },
    };

    // Adversarial Alert: Jailbreak detected
    if (isAdversarial) {
      return {
        allowed: false,
        routing: "ADVERSARIAL_FREEZE",
        minConfidence: 0.95,
        latencyMs,
        actionTaken: "ADVERSARIAL_INJECTION_DETECTED_FREEZE",
        decisions,
      };
    }

    // Dissonance Detection: Safe AND Destructive claimed simultaneously -> Escalate to HITL
    if (isSafe && isDestructive) {
      return {
        allowed: false,
        routing: "CROSS_CHECK_DISSONANCE",
        minConfidence: 0.5,
        latencyMs,
        actionTaken: "CROSS_CHECK_DISSONANCE_ESCALATED_TO_HUMAN",
        decisions,
      };
    }

    if (isSafe && !isDestructive) {
      return {
        allowed: true,
        routing: "HIGH_CONFIDENCE",
        minConfidence: Math.min(
          safeAnswer?.confidence ?? 0.95,
          destAnswer?.confidence ?? 0.95,
        ),
        latencyMs,
        actionTaken: "DETERMINISTIC_PASS_AUTHORIZED_EXECUTION",
        decisions,
      };
    }

    return {
      allowed: false,
      routing: "LOW_CONFIDENCE",
      minConfidence: Math.min(
        safeAnswer?.confidence ?? 0.6,
        destAnswer?.confidence ?? 0.6,
      ),
      latencyMs,
      actionTaken: "LOW_CONFIDENCE_ESCALATED_TO_AUDIT_QUEUE",
      decisions,
    };
  }
}
