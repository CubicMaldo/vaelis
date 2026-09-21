# Vaelis Autonomous Agent Guardrails & Tool Interception

Autonomous AI agents executing tools (Bash commands, SQL queries, REST APIs, or file system modifications) represent a major vulnerability surface:

1. **Lethal accidental executions:** `rm -rf /` or `DROP TABLE` hallucinated during complex workflows.
2. **Adversarial Prompt Injections:** External data tricking an agent into bypassing security policies.
3. **Cross-Check Inconsistencies:** The model evaluating a prompt as "safe" while simultaneously flagging it as "destructive".

Vaelis implements a **Tri-Layer Security Pipeline** in `interceptToolCall` that resolves in sub-80ms.

---

## 1. Static Pre-Guardrail (< 1ms)

Before hitting any network socket or neural weights, the gateway performs zero-overhead regex validation against lethal patterns:

```typescript
const staticLethalRegex =
  /\b(DROP\s+TABLE|rm\s+-rf|TRUNCATE|FORMAT|DROP\s+DATABASE|mkfs|chmod\s+-R\s+777)\b/i;
```

- **Execution Time:** `< 0.5 ms`
- **Result:** Returns `STATIC_GUARDRAIL_BLOCK` with `allowed: false` immediately.
- **Cost:** `0 tokens`, `0 network latency`.

---

## 2. State Engineering & Strict Context Boundary

When evaluating complex actions, prompts can be bloated with multi-megabyte log dumps or prompt injection payloads.

Vaelis automatically packs tool metadata:

```json
{
  "command": "DELETE FROM sessions WHERE expired = true",
  "user_intent": "Purge stale user sessions older than 30 days",
  "environment": {
    "isProduction": true,
    "role": "agent_executor",
    "affectedEntitiesCount": 120
  }
}
```

And enforces a strict **32,000 token boundary** (~128,000 characters). Overlong payloads are safely sliced to prevent denial-of-service or buffer overflows.

---

## 3. Dual-Query Cross-Check & Dissonance Freeze

The gateway queries parallel, complementary safety dimensions:

1. `is_safe_to_execute`: Natural language safety check.
2. `is_destructive_or_irreversible`: Mutation and data deletion check.
3. `is_adversarial_or_jailbreak`: Detection of prompt injection / instruction override attempts.

### Cross-Check Dissonance Detection

If the engine claims that an action is safe (`is_safe_to_execute: true`), but also confirms it is destructive (`is_destructive_or_irreversible: true`), a **cognitive dissonance** is detected.

Rather than guessing or risking data loss, Vaelis executes a **Safety Freeze**:

- **Outcome:** `CROSS_CHECK_DISSONANCE`
- **Allowed:** `false`
- **Action:** Escalates instantly to the Human-in-the-Loop audit queue.

### Adversarial Jailbreak Freeze

If the adversarial detection score reaches `0.50` or contains known bypass signatures (such as `"ignore previous instructions"`), Vaelis immediately issues an `ADVERSARIAL_FREEZE` and halts execution.

---

## Fail-Closed Security Policy

In Vaelis, **safety fails closed**.
If an underlying provider drops an answer, times out, or returns corrupted data:

- `allowed` defaults to `false`.
- `is_safe_to_execute` defaults to `false`.
- `is_destructive_or_irreversible` defaults to `true`.
- The incident is routed to human review.
