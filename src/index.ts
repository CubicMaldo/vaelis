/**
 * Vaelis: Micro-Agent Fast-Path Gateway & Calibrated Confidence Router for AI Agents
 *
 * Provides typed System 1 decision evaluation with sub-100ms latency,
 * multi-provider routing (TypeSafe AI Cloud, Laya Local Edge, Google Gemini Flash),
 * calibrated confidence gating, tri-layer guardrails, and zero-friction fallback.
 */

import {
  DecisionRule,
  GatewayPolicy,
  VaelisEvaluationResult,
  EvaluatorConfig,
} from "./types";
import { VaelisClient } from "./client";
import { VaelisGateway } from "./gateway";
import { BatchDispatcher } from "./batch";

export interface VaelisClientConfig extends EvaluatorConfig {
  defaultPolicy?: GatewayPolicy;
}

/**
 * Main Vaelis Gateway & Router facade.
 */
export class Vaelis {
  private client: VaelisClient;
  private gateway: VaelisGateway;

  constructor(config: VaelisClientConfig = {}) {
    this.client = new VaelisClient(config);
    this.gateway = new VaelisGateway(this.client, config.defaultPolicy);
  }

  /**
   * Evaluates unstructured context against parallel decision rules.
   * Returns calibrated probabilities and deterministic routing outcomes.
   */
  async decide(
    context: string,
    rules: DecisionRule[],
    policyOverride?: Partial<GatewayPolicy>,
  ): Promise<VaelisEvaluationResult> {
    return this.gateway.evaluate(context, rules, policyOverride);
  }

  /**
   * Helper to create typed guardrails for Agent Tool Execution.
   * Checks both routing confidence AND the actual decision value to determine safety.
   */
  createGuardrail(rule: DecisionRule) {
    return {
      validate: async (actionPayload: string) => {
        const result = await this.decide(actionPayload, [rule]);
        const decision = result.decisions[rule.id];
        // For boolean rules (e.g. "is_destructive"), a TRUE value with high
        // confidence means the threat is confirmed — deny execution.
        // For non-boolean rules, fall back to checking if the decision was accepted.
        const valueIsSafe =
          rule.kind === "boolean"
            ? decision?.value === false || decision?.value === undefined
            : (decision?.accepted ?? false);
        return {
          allowed: result.routing === "HIGH_CONFIDENCE" && valueIsSafe,
          confidence: result.minConfidence,
          outcome: result.routing,
          decision,
        };
      },
    };
  }

  /**
   * Creates a batch dispatcher for high-volume concurrent processing.
   */
  createBatchDispatcher(concurrency: number = 50): BatchDispatcher {
    return new BatchDispatcher(this.client, concurrency);
  }

  getClient(): VaelisClient {
    return this.client;
  }

  getGateway(): VaelisGateway {
    return this.gateway;
  }
}

// Backward compatibility aliases (AegisFlow -> Vaelis transition)
/** @deprecated Use `Vaelis` instead. AegisFlow was the internal development codename. */
export const AegisFlow = Vaelis;
/** @deprecated Use `VaelisClientConfig` instead. */
export type AegisFlowClientConfig = VaelisClientConfig;
/** @deprecated Use `VaelisEvaluationResult` instead. */
export type AegisDecisionOutput = VaelisEvaluationResult;

export * from "./types";
export * from "./client";
export * from "./gateway";
export * from "./batch";
