import {
  TypeSafeQuestionPayload,
  TypeSafeJevResponse,
  LLMFallbackConfig,
  SupportedLLMProvider,
  SystemOneProvider,
  EvaluatorConfig,
} from "./types";

const DEFAULT_MODELS: Record<SupportedLLMProvider, string> = {
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-2.0-flash",
  anthropic: "claude-3-5-haiku-20241022",
  deepseek: "deepseek-chat",
  mistral: "mistral-small-latest",
  openrouter: "meta-llama/llama-3.3-70b-instruct",
  ollama: "llama3.2",
  custom: "default-model",
};

const DEFAULT_BASE_URLS: Partial<Record<SupportedLLMProvider, string>> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

/**
 * Enriches a partial LLM configuration with defaults, parent config, and environment keys.
 */
function enrichLLMConfig(
  raw: LLMFallbackConfig,
  parent: EvaluatorConfig,
): LLMFallbackConfig {
  const provider = raw.provider || "openai";
  const model =
    raw.model ||
    parent.modelName ||
    DEFAULT_MODELS[provider] ||
    "gpt-4o-mini";

  let apiKey = raw.apiKey || parent.apiKey;

  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  if (!apiKey && env) {
    if (provider === "groq") apiKey = env.GROQ_API_KEY;
    else if (provider === "openai") apiKey = env.OPENAI_API_KEY;
    else if (provider === "anthropic") apiKey = env.ANTHROPIC_API_KEY;
    else if (provider === "gemini") apiKey = env.GEMINI_API_KEY || parent.geminiApiKey;
    else if (provider === "deepseek") apiKey = env.DEEPSEEK_API_KEY;
    else if (provider === "mistral") apiKey = env.MISTRAL_API_KEY;
    else if (provider === "openrouter") apiKey = env.OPENROUTER_API_KEY;
  }

  return {
    ...raw,
    provider,
    model,
    apiKey,
    baseUrl: raw.baseUrl || parent.endpoint,
  };
}

/**
 * Resolves LLM Fallback configuration from EvaluatorConfig and process.env.
 */
export function resolveLLMFallbackConfig(
  evaluatorConfig: EvaluatorConfig,
): LLMFallbackConfig | null {
  const env = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;

  // If explicitly disabled or deterministic, do not attempt LLM fallback
  if (evaluatorConfig.fallback === "deterministic") {
    return null;
  }

  // 1. Explicit llmFallback
  if (evaluatorConfig.llmFallback) {
    return enrichLLMConfig(evaluatorConfig.llmFallback, evaluatorConfig);
  }

  // 2. Object passed into fallback
  if (
    typeof evaluatorConfig.fallback === "object" &&
    evaluatorConfig.fallback !== null
  ) {
    return enrichLLMConfig(evaluatorConfig.fallback, evaluatorConfig);
  }

  // 3. Provider set directly as primary LLM provider (e.g. provider: 'openai', provider: 'groq', etc.)
  const prov = evaluatorConfig.provider as any;
  if (prov && (prov in DEFAULT_MODELS || prov === "gemini-flash")) {
    const resolvedProv: SupportedLLMProvider =
      prov === "gemini-flash" ? "gemini" : (prov as SupportedLLMProvider);
    return enrichLLMConfig(
      {
        provider: resolvedProv,
        apiKey: evaluatorConfig.apiKey || evaluatorConfig.geminiApiKey,
        model: evaluatorConfig.modelName,
        baseUrl: evaluatorConfig.endpoint,
      },
      evaluatorConfig,
    );
  }

  // 4. Backward-compatible Gemini configuration
  if (
    evaluatorConfig.geminiApiKey ||
    evaluatorConfig.fallback === "gemini-flash"
  ) {
    const key =
      evaluatorConfig.geminiApiKey ||
      env?.GEMINI_API_KEY;
    if (key) {
      return {
        provider: "gemini",
        apiKey: key,
        model: evaluatorConfig.modelName || DEFAULT_MODELS.gemini,
        baseUrl: evaluatorConfig.endpoint,
      };
    }
  }

  // 5. Auto-detect environment keys if fallback is not explicitly disabled
  if (env) {
    if (env.GROQ_API_KEY) {
      return {
        provider: "groq",
        apiKey: env.GROQ_API_KEY,
        model: DEFAULT_MODELS.groq,
      };
    }
    if (env.OPENAI_API_KEY) {
      return {
        provider: "openai",
        apiKey: env.OPENAI_API_KEY,
        model: DEFAULT_MODELS.openai,
      };
    }
    if (env.DEEPSEEK_API_KEY) {
      return {
        provider: "deepseek",
        apiKey: env.DEEPSEEK_API_KEY,
        model: DEFAULT_MODELS.deepseek,
      };
    }
    if (env.ANTHROPIC_API_KEY) {
      return {
        provider: "anthropic",
        apiKey: env.ANTHROPIC_API_KEY,
        model: DEFAULT_MODELS.anthropic,
      };
    }
    if (env.GEMINI_API_KEY) {
      return {
        provider: "gemini",
        apiKey: env.GEMINI_API_KEY,
        model: DEFAULT_MODELS.gemini,
      };
    }
  }

  return null;
}

/**
 * Builds the classification instruction prompt for LLM evaluation.
 */
function buildSystemPrompt(): string {
  return `You are a System 1 fast-path classification engine (Jev emulator).
Evaluate the provided state strictly and return answers for each question ID.
Respond ONLY with valid JSON matching this exact structure:
{
  "answers": {
    "<question_id>": {
      "type": "choice" | "noul" | "score",
      "choice": "selected_option_key (for choice questions)",
      "noul": 0.0 to 1.0 (probability of TRUE for boolean questions),
      "score": 0.0 to 1.0 (continuous rating for score questions),
      "confidence": 0.50 to 1.00 (calibrated prediction confidence)
    }
  }
}`;
}

function buildUserContent(
  state: string,
  questions: Record<string, TypeSafeQuestionPayload>,
): string {
  return `STATE TO EVALUATE:
${state}

QUESTIONS SCHEMA:
${JSON.stringify(questions, null, 2)}`;
}

/**
 * Checks if the endpoint is local (e.g. Ollama or local vLLM).
 */
function isLocalEndpoint(provider: SupportedLLMProvider, baseUrl?: string): boolean {
  if (provider === "ollama") return true;
  if (baseUrl && (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1"))) {
    return true;
  }
  return false;
}

/**
 * Strips markdown code fences or surrounding text and safely parses JSON without throwing.
 */
function cleanAndParseJSON(raw: string): any {
  let text = raw.trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  } else {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Normalizes parsed JSON into the standard TypeSafeJevResponse answers structure.
 */
function extractAnswers(
  parsed: any,
  questions: Record<string, TypeSafeQuestionPayload>,
): TypeSafeJevResponse["answers"] {
  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  // Case 1: answers is an object keyed by question ID
  if (
    parsed.answers &&
    typeof parsed.answers === "object" &&
    !Array.isArray(parsed.answers)
  ) {
    return parsed.answers;
  }

  // Case 2: answers is an array of items [{ id: "...", ... }, { ruleId: "...", ... }]
  if (Array.isArray(parsed.answers)) {
    const mapped: TypeSafeJevResponse["answers"] = {};
    for (const item of parsed.answers) {
      const id = item.id || item.ruleId || item.question_id || item.questionId;
      if (id) {
        mapped[id] = item;
      }
    }
    if (Object.keys(mapped).length > 0) {
      return mapped;
    }
  }

  // Case 3: parsed itself is an array of answer items
  if (Array.isArray(parsed)) {
    const mapped: TypeSafeJevResponse["answers"] = {};
    for (const item of parsed) {
      const id = item.id || item.ruleId || item.question_id || item.questionId;
      if (id) {
        mapped[id] = item;
      }
    }
    if (Object.keys(mapped).length > 0) {
      return mapped;
    }
  }

  // Case 4: parsed directly has question keys at root
  const questionKeys = Object.keys(questions);
  const directMatches = questionKeys.filter((k) => k in parsed);
  if (directMatches.length > 0) {
    const mapped: TypeSafeJevResponse["answers"] = {};
    for (const k of directMatches) {
      mapped[k] = parsed[k];
    }
    return mapped;
  }

  return {};
}

/**
 * Universal evaluator for OpenAI-compatible REST APIs (OpenAI, Groq, DeepSeek, Mistral, Ollama, etc.)
 */
async function callOpenAICompatible(
  config: LLMFallbackConfig,
  state: string,
  questions: Record<string, TypeSafeQuestionPayload>,
  startTime: number,
): Promise<TypeSafeJevResponse & { latencyMs: number; provider: SystemOneProvider }> {
  const provider = config.provider || "openai";
  const baseUrl =
    config.baseUrl ||
    DEFAULT_BASE_URLS[provider] ||
    "https://api.openai.com/v1";
  const model = config.model || DEFAULT_MODELS[provider] || "gpt-4o-mini";

  const isLocal = isLocalEndpoint(provider, baseUrl);
  const apiKey = config.apiKey?.trim();

  if (!isLocal && !apiKey) {
    throw new Error(
      `[LLM Fallback ${provider}] Missing API key for cloud provider. Please provide apiKey in config or set ${provider.toUpperCase()}_API_KEY.`,
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(config.headers || {}),
  };

  const body = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserContent(state, questions) },
    ],
  };

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`[LLM Fallback ${provider}] HTTP ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as any;
  if (data.error) {
    throw new Error(
      `[LLM Fallback ${provider}] API Error: ${data.error.message || JSON.stringify(data.error)}`,
    );
  }

  const content = data.choices?.[0]?.message?.content || "{}";
  const parsed = cleanAndParseJSON(content);
  const latencyMs = Math.round(performance.now() - startTime);

  const providerName = (
    ["openai", "groq", "deepseek", "mistral", "openrouter", "ollama"].includes(provider)
      ? provider
      : "llm-fallback"
  ) as SystemOneProvider;

  return {
    model: `${provider}:${model}`,
    answers: extractAnswers(parsed, questions),
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? Math.round(state.length / 4),
      output_tokens: data.usage?.completion_tokens ?? Object.keys(questions).length * 8,
    },
    latencyMs,
    provider: providerName,
  };
}

/**
 * Anthropic Messages REST API evaluator
 */
async function callAnthropic(
  config: LLMFallbackConfig,
  state: string,
  questions: Record<string, TypeSafeQuestionPayload>,
  startTime: number,
): Promise<TypeSafeJevResponse & { latencyMs: number; provider: SystemOneProvider }> {
  const model = config.model || DEFAULT_MODELS.anthropic;
  const apiKey = config.apiKey?.trim();

  if (!apiKey) {
    throw new Error("[LLM Fallback anthropic] Missing API key for Anthropic provider. Please provide apiKey or set ANTHROPIC_API_KEY.");
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URLS.anthropic || "https://api.anthropic.com/v1";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    ...(config.headers || {}),
  };

  const body = {
    model,
    max_tokens: 1024,
    temperature: 0,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserContent(state, questions) }],
  };

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`[LLM Fallback anthropic] HTTP ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as any;
  if (data.error) {
    throw new Error(
      `[LLM Fallback anthropic] API Error: ${data.error.message || JSON.stringify(data.error)}`,
    );
  }

  const text =
    data.content
      ?.filter((b: any) => b.type === "text" || !b.type)
      ?.map((b: any) => b.text || "")
      ?.join("\n") || "{}";

  const parsed = cleanAndParseJSON(text);
  const latencyMs = Math.round(performance.now() - startTime);

  return {
    model: `anthropic:${model}`,
    answers: extractAnswers(parsed, questions),
    usage: {
      input_tokens: data.usage?.input_tokens ?? Math.round(state.length / 4),
      output_tokens: data.usage?.output_tokens ?? Object.keys(questions).length * 8,
    },
    latencyMs,
    provider: "anthropic",
  };
}

/**
 * Google Gemini REST API evaluator (Zero external SDK dependencies)
 */
async function callGeminiREST(
  config: LLMFallbackConfig,
  state: string,
  questions: Record<string, TypeSafeQuestionPayload>,
  startTime: number,
): Promise<TypeSafeJevResponse & { latencyMs: number; provider: SystemOneProvider }> {
  const model = config.model || DEFAULT_MODELS.gemini;
  const apiKey = config.apiKey?.trim();

  if (!apiKey) {
    throw new Error("[LLM Fallback gemini] Missing API key for Gemini provider. Please provide apiKey or set GEMINI_API_KEY.");
  }

  const fullPrompt = `${buildSystemPrompt()}

${buildUserContent(state, questions)}`;

  const baseUrl = config.baseUrl || DEFAULT_BASE_URLS.gemini || "https://generativelanguage.googleapis.com/v1beta";
  const url = `${baseUrl.replace(/\/+$/, "")}/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`[LLM Fallback gemini] HTTP ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as any;
  if (data.error) {
    throw new Error(
      `[LLM Fallback gemini] API Error: ${data.error.message || JSON.stringify(data.error)}`,
    );
  }

  const rawText =
    data.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      ?.filter(Boolean)
      ?.join("\n") || "{}";

  const parsed = cleanAndParseJSON(rawText);
  const latencyMs = Math.round(performance.now() - startTime);

  return {
    model: `gemini:${model}`,
    answers: extractAnswers(parsed, questions),
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount ?? Math.round(state.length / 4),
      output_tokens:
        data.usageMetadata?.candidatesTokenCount ?? Object.keys(questions).length * 8,
    },
    latencyMs,
    provider: "gemini-flash",
  };
}

/**
 * Evaluates state and questions using any configured LLM.
 */
export async function evaluateWithUniversalLLM(
  config: LLMFallbackConfig,
  state: string,
  questions: Record<string, TypeSafeQuestionPayload>,
  startTime: number = performance.now(),
): Promise<(TypeSafeJevResponse & { latencyMs: number; provider: SystemOneProvider }) | null> {
  // 1. Custom Evaluator function
  if (typeof config.customEvaluator === "function") {
    const answers = await config.customEvaluator({ state, questions });
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      model: "custom-evaluator",
      answers: extractAnswers(answers, questions),
      usage: {
        input_tokens: Math.round(state.length / 4),
        output_tokens: Object.keys(questions).length * 8,
      },
      latencyMs,
      provider: "llm-fallback",
    };
  }

  const provider = config.provider || "openai";

  let result: (TypeSafeJevResponse & { latencyMs: number; provider: SystemOneProvider }) | null = null;
  if (provider === "anthropic") {
    result = await callAnthropic(config, state, questions, startTime);
  } else if (provider === "gemini") {
    result = await callGeminiREST(config, state, questions, startTime);
  } else {
    result = await callOpenAICompatible(config, state, questions, startTime);
  }

  if (!result || !result.answers || Object.keys(result.answers).length === 0) {
    console.warn(`[VaelisClient] LLM fallback (${provider}) returned empty answers.`);
    return null;
  }

  return result;
}
