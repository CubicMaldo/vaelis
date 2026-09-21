# Vaelis Architecture & System Design

**Vaelis** is a high-performance **Fast-Path Gateway & Calibrated Decision Router** designed to eliminate latency and token waste in autonomous AI agent systems.

---

## The System 1 vs. System 2 Paradigm

Modern AI agents often route every minor intermediate decision—such as checking if a SQL query is safe, categorizing user intent, or verifying permission boundaries—to heavy reasoning models (System 2: GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Pro).

This introduces two critical bottlenecks:

1. **Severe Latency:** System 2 models require 800ms to 3,500ms per turn.
2. **Exponential Token Costs:** Multi-turn agent loops burning tens of thousands of tokens on trivial boolean or categorical checks.

```
                  ┌───────────────────────────────┐
                  │       Agent Context / State   │
                  └──────────────┬────────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │     Vaelis Gateway    │
                     │  (System 1 Fast-Path) │
                     └───────────┬───────────┘
                                 │
                 Confidence Score & Dissonance Check
                 ┌───────────────┼───────────────┐
                 │               │               │
                 ▼               ▼               ▼
           >= 0.90 Conf    0.65 - 0.89 Conf    < 0.65 Conf or
         (High Confidence)(Medium Confidence) Dissonance / Jailbreak
                 │               │               │
                 ▼               ▼               ▼
        ┌────────────────┐ ┌───────────────┐ ┌───────────────┐
        │  Deterministic │ │ Awaken Heavy  │ │ Human-in-the- │
        │  Action Pass   │ │ LLM (System 2)│ │  Loop (HITL)  │
        │ (0 LLM Tokens) │ │(Claude/Gemini)│ │     Queue     │
        └────────────────┘ └───────────────┘ └───────────────┘
```

Vaelis acts as the **System 1 reflex layer**:

- Resolves $\approx 80\%$ of routine decisions deterministically in **< 50ms**.
- Reserves heavy System 2 reasoning only for genuinely ambiguous states ($0.65 \le \text{confidence} < 0.90$).
- Guarantees zero unmonitored failures by escalating low-confidence or dissonant states to Human-in-the-Loop (HITL) queues.

---

## Calibrated Mathematical Confidence

Traditional LLM classifiers return text tokens like `"true"` or `"false"`, without reliable probabilistic grounding.

Vaelis evaluates decisions against **calibrated probability distributions**:

- **Boolean / Noul (`noul`):** Returns true calibrated probability $P \in [0.00, 1.00]$.
- **Categorical Choice (`choice`):** Probabilities distributed over candidate categories (up to 255 options).
- **Continuous Score (`score`):** Normalized linear confidence metrics ($0.00$ to $1.00$).

Decisions are only marked as `accepted` if their calibrated confidence clears the strict policy threshold:

$$\text{accepted} = \text{confidence} \ge \text{policy.highConfidenceThreshold}$$

---

## Three-Tier Routing Engine

Every evaluation produces a deterministic `RoutingOutcome`:

| Routing Outcome              | Condition                           | Action Taken                       | Token Savings            |
| :--------------------------- | :---------------------------------- | :--------------------------------- | :----------------------- |
| **`HIGH_CONFIDENCE`**        | $\min(\text{Conf}) \ge 0.90$        | `EXECUTE_DETERMINISTIC_ACTION`     | **100%** (0 LLM tokens)  |
| **`MEDIUM_CONFIDENCE`**      | $0.65 \le \min(\text{Conf}) < 0.90$ | `AWAKEN_HEAVY_LLM_SYSTEM_2`        | **0%** (Awaken System 2) |
| **`LOW_CONFIDENCE`**         | $\min(\text{Conf}) < 0.65$          | `ESCALATED_TO_HUMAN`               | Escalated to audit queue |
| **`STATIC_GUARDRAIL_BLOCK`** | Lethal regex trigger                | `STATIC_GUARDRAIL_TRIGGERED`       | Immediate block (<1ms)   |
| **`CROSS_CHECK_DISSONANCE`** | Contradictory answers               | `CROSS_CHECK_DISSONANCE_ESCALATED` | Immediate freeze to HITL |
| **`ADVERSARIAL_FREEZE`**     | Jailbreak signal $\ge 0.50$         | `ADVERSARIAL_INJECTION_DETECTED`   | Immediate freeze to HITL |

---

## Latency Profile

| Stage                      | Mechanism                                 | Typical Latency      |
| :------------------------- | :---------------------------------------- | :------------------- |
| **Static Guardrail**       | Regex compile & match                     | **0.5 - 1 ms**       |
| **Deterministic Fallback** | Local heuristic token engine              | **1 - 5 ms**         |
| **Laya Local Edge**        | Open-weight GGUF / vLLM on localhost:8000 | **15 - 40 ms**       |
| **TypeSafe Cloud (Jev)**   | Direct HTTP/2 System 1 pipeline           | **35 - 75 ms**       |
| **Gemini Flash Fallback**  | Google GenAI SDK                          | **250 - 550 ms**     |
| **Standard Heavy LLM**     | GPT-4o / Claude 3.5 Sonnet / Gemini Pro   | **1,200 - 3,500 ms** |
