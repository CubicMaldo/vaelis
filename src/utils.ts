/**
 * Normalizes and truncates a state payload (string or object) to a safe string representation.
 * @param input The unstructured context or structured state object.
 * @param maxChars The maximum number of characters to retain (defaults to 32,000 for standard LLM context boundaries).
 * @returns A truncated string representation of the state.
 */
export function sanitizeState(input: unknown, maxChars: number = 32000): string {
  let normalized: string;
  if (typeof input === "string") {
    normalized = input;
  } else if (input !== null && typeof input === "object") {
    try {
      normalized = JSON.stringify({
        ...input,
        _timestamp: new Date().toISOString(),
      });
    } catch {
      normalized = String(input);
    }
  } else {
    normalized = String(input);
  }
  return normalized.length > maxChars
    ? normalized.slice(0, maxChars)
    : normalized;
}

/**
 * Resolves the three-tier routing decision based on minimum confidence thresholds.
 * @param result The evaluation result or security verdict.
 * @param thresholds Optional overrides for high and medium confidence thresholds.
 * @returns The resolved routing tier: 'HIGH', 'MEDIUM', or 'ESCALATE'.
 */
export function resolveRoutingTier(
  result: { minConfidence: number },
  thresholds: { high?: number; medium?: number } = {}
): import("./types").RoutingTier {
  const high = thresholds.high ?? 0.9;
  const medium = thresholds.medium ?? 0.65;
  if (result.minConfidence >= high) return "HIGH";
  if (result.minConfidence >= medium) return "MEDIUM";
  return "ESCALATE";
}

