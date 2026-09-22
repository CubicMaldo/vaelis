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
  gemini: "gemini-2.5-flash",
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
};

/**
 * Resolves LLM Fallback configuration from EvaluatorConfig and process.env.
 */
export function resolveLLMFallbackConfig(
  evaluatorConfig: EvaluatorConfig,
): LLMFallbackConfig | null {
  // 1. Explicit llmFallback
  if (evaluatorConfig.llmFallback) {
    return evaluatorConfig.llmFallback;
  }

  // 2. Object passed into fallback
  if (
    typeof evaluatorConfig.fallback === "object" &&
    evaluatorConfig.fallback !== null
  ) {
    return evaluatorConfig.fallback;
  }

  // 3. Backward-compatible Gemini configuration
  if (
    evaluatorConfig.geminiApiKey ||
    evaluatorConfig.fallback === "gemini-flash" ||
    evaluatorConfig.provider === "gemini-flash"
  ) {
    const key =
      evaluatorConfig.geminiApiKey ||
      (typeof process !== "undefined"
        ? process.env?.GEMINI_API_KEY
        : undefined);
    if (key) {
      return {
        provider: "gemini",
        apiKey: key,
        model: "gemini-2.5-flash",
      };
    }
  }

  // 4. Auto-detect environment keys if fallback is not explicitly set to 'deterministic'
  if (
    evaluatorConfig.fallback !== "deterministic" &&
    typeof process !== "undefined" &&
    process.env
  ) {
    if (process.env.GROQ_API_KEY) {
      return {
        provider: "groq",
        apiKey: process.env.GROQ_API_KEY,
        model: DEFAULT_MODELS.groq,
      };
    }
    if (process.env.OPENAI_API_KEY) {
      return {
        provider: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: DEFAULT_MODELS.openai,
      };
    }
    if (process.env.DEEPSEEK_API_KEY) {
      return {
        provider: "deepseek",
        apiKey: process.env.DEEPSEEK_API_KEY,
        model: DEFAULT_MODELS.deepseek,
      };
    }
    if (process.env.ANTHROPIC_API_KEY) {
      return {
        provider: "anthropic",
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: DEFAULT_MODELS.anthropic,
      };
    }
    if (process.env.GEMINI_API_KEY) {
      return {
        provider: "gemini",
        apiKey: process.env.GEMINI_API_KEY,
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
 * Strips markdown code fences if present and parses JSON.
 */
function cleanAndParseJSON(raw: string): any {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return JSON.parse(text);
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

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
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
    answers: parsed.answers || {},
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
    throw new Error("[LLM Fallback anthropic] Missing API key");
  }

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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
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
  const text = data.content?.[0]?.text || "{}";
  const parsed = cleanAndParseJSON(text);
  const latencyMs = Math.round(performance.now() - startTime);

  return {
    model: `anthropic:${model}`,
    answers: parsed.answers || {},
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
    throw new Error("[LLM Fallback gemini] Missing API key");
  }

  const fullPrompt = `${buildSystemPrompt()}

${buildUserContent(state, questions)}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = cleanAndParseJSON(rawText);
  const latencyMs = Math.round(performance.now() - startTime);

  return {
    model: `gemini:${model}`,
    answers: parsed.answers || {},
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
      answers,
      usage: {
        input_tokens: Math.round(state.length / 4),
        output_tokens: Object.keys(questions).length * 8,
      },
      latencyMs,
      provider: "llm-fallback",
    };
  }

  const provider = config.provider || "openai";

  if (provider === "anthropic") {
    return callAnthropic(config, state, questions, startTime);
  }

  if (provider === "gemini") {
    return callGeminiREST(config, state, questions, startTime);
  }

  // All OpenAI-compatible providers: openai, groq, deepseek, mistral, openrouter, ollama, custom
  return callOpenAICompatible(config, state, questions, startTime);
}
