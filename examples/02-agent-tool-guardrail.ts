/**
 * Example 02: Autonomous AI Agent Tool Guardrail
 *
 * Demonstrates how to intercept dangerous tool invocations (Bash / SQL / Python / APIs)
 * before execution using Vaelis's 3-Layer Security Pipeline:
 * 1. Static Pre-Guardrail (<1ms lethal pattern block)
 * 2. State Engineering (32k token boundary)
 * 3. Dual-Query Cross-Check & Dissonance Freeze
 */

import { Vaelis } from "../src";

async function main() {
  const vaelis = new Vaelis();
  const gateway = vaelis.getGateway();

  console.log("🛡️ Autonomous Agent Tool Interception Demo\n");

  // Test Case 1: Lethal static command (DROP TABLE)
  console.log("--- Test Case 1: Static Lethal Command ---");
  const verdict1 = await gateway.interceptToolCall({
    command: "DROP TABLE users CASCADE;",
    context: "The user said: clean up the test users database table",
    environment: {
      isProduction: true,
      role: "database_admin",
      affectedEntitiesCount: 10000,
    },
  });

  console.log(`Command: "DROP TABLE users CASCADE;"`);
  console.log(`Allowed: ${verdict1.allowed}`);
  console.log(`Routing: ${verdict1.routing}`);
  console.log(`Latency: ${verdict1.latencyMs}ms (<1ms deterministic regex)`);
  console.log(`Action Taken: ${verdict1.actionTaken}\n`);

  // Test Case 2: Safe read-only command
  console.log("--- Test Case 2: Safe Read Command ---");
  const verdict2 = await gateway.interceptToolCall({
    command:
      "SELECT id, email, created_at FROM users WHERE active = true LIMIT 50;",
    context: "Agent is fulfilling request to list recent active users",
    environment: {
      isProduction: false,
      role: "read_only_agent",
      affectedEntitiesCount: 50,
    },
  });

  console.log(`Command: "SELECT id, email..."`);
  console.log(`Allowed: ${verdict2.allowed}`);
  console.log(`Routing: ${verdict2.routing}`);
  console.log(`Latency: ${verdict2.latencyMs}ms`);
  console.log(`Action Taken: ${verdict2.actionTaken}\n`);

  // Test Case 3: Middleware wrapper for Agent Tools
  console.log("--- Test Case 3: Tool Guardrail Wrapper ---");
  const safetyGuardrail = vaelis.createGuardrail({
    id: "is_destructive",
    kind: "boolean",
    question:
      "Does this action delete, overwrite, or mutate irreversible assets?",
  });

  async function executeAgentTool(toolName: string, payload: string) {
    const check = await safetyGuardrail.validate(payload);
    if (!check.allowed) {
      console.log(
        `⛔ [Blocked] Tool "${toolName}" denied execution! Reason: ${check.outcome}`,
      );
      return { status: "BLOCKED", outcome: check.outcome };
    }
    console.log(
      `✅ [Allowed] Executing tool "${toolName}" with payload: ${payload}`,
    );
    return { status: "EXECUTED" };
  }

  await executeAgentTool("bash_executor", "rm -rf /var/log/audit");
  await executeAgentTool("bash_executor", "echo 'Hello World' >> test.log");
}

main().catch(console.error);
