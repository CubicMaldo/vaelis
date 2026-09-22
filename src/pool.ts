import { EvaluatorConfig } from "./types";
import { Vaelis } from "./index";

export interface VaelisPoolConfig {
  maxPoolSize?: number;
}

interface CachedGatewayEntry {
  instance: Vaelis;
  lastAccessed: number;
}

export class VaelisPool {
  private static pool = new Map<string, CachedGatewayEntry>();
  private static defaultMaxSize = 32;

  /**
   * Gets or creates a cached Vaelis instance based on the provided configuration.
   * Uses an LRU (Least Recently Used) eviction policy.
   * 
   * @param config The evaluator configuration (used to generate a cache key).
   * @param poolConfig Optional pool configuration to specify max pool size.
   */
  static getOrCreate(config: EvaluatorConfig, poolConfig?: VaelisPoolConfig): Vaelis {
    const key = this.generateCacheKey(config);
    const maxSize = poolConfig?.maxPoolSize ?? this.defaultMaxSize;

    if (this.pool.has(key)) {
      const entry = this.pool.get(key)!;
      entry.lastAccessed = Date.now();
      return entry.instance;
    }

    if (this.pool.size >= maxSize) {
      this.evictLRU();
    }

    const instance = new Vaelis(config);
    this.pool.set(key, { instance, lastAccessed: Date.now() });

    return instance;
  }

  private static generateCacheKey(config: EvaluatorConfig): string {
    return JSON.stringify({
      provider: config.provider,
      endpoint: config.endpoint,
      // We truncate keys to avoid storing full credentials in cache keys, 
      // but keep enough to differentiate different accounts
      apiKey: config.apiKey ? config.apiKey.substring(0, 8) : undefined,
      fallbackApiKey: config.fallbackApiKey ? config.fallbackApiKey.substring(0, 8) : undefined,
      geminiApiKey: config.geminiApiKey ? config.geminiApiKey.substring(0, 8) : undefined,
      fallback: config.fallback,
      modelName: config.modelName,
      llmFallback: config.llmFallback ? {
        provider: config.llmFallback.provider,
        baseUrl: config.llmFallback.baseUrl,
        model: config.llmFallback.model,
        apiKey: config.llmFallback.apiKey ? config.llmFallback.apiKey.substring(0, 8) : undefined
      } : undefined
    });
  }

  private static evictLRU() {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.pool.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pool.delete(oldestKey);
    }
  }

  /**
   * Clears all cached instances. Useful for testing or manual memory management.
   */
  static clear() {
    this.pool.clear();
  }
}

