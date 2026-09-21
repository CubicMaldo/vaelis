# Supported Providers & Resilience Architecture

Vaelis is engineered to be **resilient to network partitions, provider downtime, and air-gapped environments**. It supports 4 provider tiers with automatic cascading fallback.

---

## 1. TypeSafe AI Cloud (`typesafe`)

The primary System 1 model (`jev-latest`), optimized for microsecond probability calibration and low latency.

### Setup

```bash
export TYPESAFE_API_KEY="your-typesafe-api-key"
```

```typescript
import { Vaelis } from "vaelis";

const vaelis = new Vaelis({
  provider: "typesafe",
  apiKey: process.env.TYPESAFE_API_KEY,
  modelName: "jev-latest",
});
```

- **Latency:** ~35ms - 75ms.
- **Capabilities:** Boolean probability (`noul`), 255-way categorical choice, continuous scoring.

---

## 2. Laya Local Edge (`laya-local`)

Run System 1 models locally on your edge server, Docker container, or Kubernetes cluster using open weights. Zero data leaves your VPC.

### Setup

Run the Laya container on port `8000`:

```bash
docker run -d -p 8000:8000 --gpus all typesafe/laya:latest
```

```typescript
import { Vaelis } from "vaelis";

const vaelis = new Vaelis({
  provider: "laya-local",
  endpoint: "http://localhost:8000/v1/systemone",
});
```

- **Latency:** ~15ms - 40ms.
- **Data Privacy:** 100% on-premise, zero egress.

---

## 3. Google Gemini Flash Fallback (`gemini-flash`)

If the primary System 1 provider experiences network degradation or downtime, Vaelis can automatically cascade to Google Gemini 2.5 Flash via the official `@google/genai` SDK.

### Setup

```bash
export GEMINI_API_KEY="your-gemini-api-key"
```

```typescript
import { Vaelis } from "vaelis";

const vaelis = new Vaelis({
  provider: "typesafe",
  apiKey: process.env.TYPESAFE_API_KEY,
  fallback: "gemini-flash",
  geminiApiKey: process.env.GEMINI_API_KEY,
});
```

- Structured JSON schema enforcement ensures compatible answers.
- **Latency:** ~300ms - 600ms.

---

## 4. Offline Deterministic Heuristic Engine (`deterministic`)

For unit tests, air-gapped CI environments, or emergency offline operations, Vaelis includes a zero-dependency deterministic heuristic engine.

```typescript
import { Vaelis } from "vaelis";

const vaelis = new Vaelis({
  provider: "deterministic",
});
```

- **Latency:** ~1ms - 5ms.
- **Requirements:** 0 API keys, 0 network access.
