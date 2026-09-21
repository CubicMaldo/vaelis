# Vaelis API Reference

Comprehensive TypeScript API specification for `@vaelis/core` (`vaelis`).

---

## Table of Contents

- [Vaelis (Facade)](#vaelis-facade)
  - [`constructor(config?)`](#constructorconfig)
  - [`decide(context, rules, policyOverride?)`](#decidecontext-rules-policyoverride)
  - [`createGuardrail(rule)`](#createguardrailrule)
  - [`createBatchDispatcher(concurrency?)`](#createbatchdispatcherconcurrency)
  - [`getClient()`](#getclient)
  - [`getGateway()`](#getgateway)
- [VaelisGateway](#vaelisgateway)
  - [`evaluate(context, rules, policyOverride?)`](#evaluatecontext-rules-policyoverride)
  - [`interceptToolCall(params)`](#intercepttoolcallparams)
- [VaelisClient](#vaelisclient)
  - [`evaluate(state, questions)`](#evaluatestate-questions)
  - [`query(context, rules)`](#querycontext-rules)
- [BatchDispatcher](#batchdispatcher)
  - [`processPool(items, evaluateFn)`](#processpoolitems-evaluatefn)
- [Core Types & Interfaces](#core-types--interfaces)

---

## Vaelis (Facade)

The high-level facade providing a unified developer interface.

```typescript
import { Vaelis } from "vaelis";

const vaelis = new Vaelis({
  provider: "typesafe",
  apiKey: process.env.TYPESAFE_API_KEY,
  defaultPolicy: {
    highConfidenceThreshold: 0.9,
    mediumConfidenceThreshold: 0.65,
  },
});
```

### `constructor(config?: VaelisClientConfig)`

Initializes the Vaelis instance with underlying `VaelisClient` and `VaelisGateway`.

- `config.provider`: `"typesafe" | "gemini-flash" | "laya-local" | "deterministic"` (default: `"typesafe"`).
- `config.apiKey`: string (optional API key for TypeSafe Cloud or secured edge).
- `config.geminiApiKey`: string (optional API key for Gemini Flash fallback).
- `config.endpoint`: string (optional custom endpoint, e.g., `'http://localhost:8000/v1/systemone'`).
- `config.fallback`: `"gemini-flash" | "deterministic"` (default: `"gemini-flash"`).
- `config.defaultPolicy`: `GatewayPolicy` (custom confidence thresholds).

---

### `decide(context, rules, policyOverride?): Promise<VaelisEvaluationResult>`

Evaluates unstructured context against parallel decision rules.

```typescript
const result = await vaelis.decide(context, [
  { id: "is_urgent", kind: "boolean", question: "Is this request urgent?" },
  {
    id: "intent",
    kind: "choice",
    question: "Classify intent",
    options: ["billing", "tech", "sales"],
  },
]);
```

**Returns:**

- `decisions`: Map of results keyed by rule ID.
- `routing`: `"HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE" | "STATIC_GUARDRAIL_BLOCK" | "CROSS_CHECK_DISSONANCE" | "ADVERSARIAL_FREEZE"`
- `minConfidence`: Lowest calibrated confidence score across all rules.
- `tokenSavingsPercent`: `100` if high confidence, `0` if medium confidence.
- `latencyMs`: Total evaluation latency in milliseconds.
- `escalatedToHuman`: Boolean indicating whether manual audit is required.

---

### `createGuardrail(rule: DecisionRule)`

Returns a plug-and-play middleware validator for Agent Tool Execution.

```typescript
const guard = vaelis.createGuardrail({
  id: "is_destructive",
  kind: "boolean",
  question:
    "Does this action delete, overwrite, or mutate irreversible assets?",
});

const check = await guard.validate("rm -rf /data");
if (!check.allowed) {
  throw new Error(`Tool execution blocked: ${check.outcome}`);
}
```

---

### `createBatchDispatcher(concurrency?: number): BatchDispatcher`

Creates an instance of `BatchDispatcher` configured with a sliding window of concurrent in-flight evaluations (default concurrency: `50`).

---

## VaelisGateway

Direct gateway class for low-level policy configuration and agent tool interception.

### `interceptToolCall(params: ToolInterceptParams): Promise<SecurityVerdict>`

Runs the 3-Layer Security Pipeline before executing autonomous commands:

```typescript
const verdict = await vaelis.getGateway().interceptToolCall({
  command: "DROP TABLE users;",
  context: "User asked to clean up old records",
  environment: {
    isProduction: true,
    role: "admin",
    affectedEntitiesCount: 5000,
  },
});
```

**Returns:** `SecurityVerdict`:

- `allowed`: `boolean`
- `routing`: `RoutingOutcome`
- `minConfidence`: `number`
- `latencyMs`: `number`
- `actionTaken`: `string`
- `decisions`: Map of individual guardrail verdicts.

---

## BatchDispatcher

### `processPool<T, R>(items: T[], evaluateFn: (item: T) => Promise<R>)`

Executes high-throughput evaluations across a pool of arbitrary inputs while strictly maintaining at most `concurrency` active promises.

```typescript
const results = await dispatcher.processPool(items, async (item) => {
  return vaelis.decide(item.text, rules);
});
```

**Returns:** `Array<{ success: boolean; result?: R; error?: unknown }>`

- Guarantees error isolation: one failing item does not reject the pool.
