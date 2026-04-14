# Module Specifications

## 1. Retriever (Out of Scope for Gateway)
В текущей архитектуре Gateway не выполняет RAG. Ожидается, что агенты сами выполняют поиск и аугментацию контекста перед отправкой запроса в Gateway.

## 2. Tools / APIs (LLM Proxy)
- **Контракт:** Совместим с OpenAI API (`/v1/chat/completions`).
- **Ошибки:** 
  - 401/403: Auth/Guardrails.
  - 503: No healthy providers.
  - 500: Provider upstream error.
- **Timeout:** 60 секунд на установку соединения.
- **Защита:** Guardrails (regex-based prompt injection detection).

## 3. Memory / Context
- **Session State:** Stateless. Gateway не хранит историю.
- **Context Budget:** Ограничивается лимитами выбранного LLM-провайдера (передается прозрачно).

## 4. Agent / Orchestrator (Balancer)
- **Шаги:** Auth -> Guardrails -> Route -> Proxy -> Telemetry.
- **Правила переходов:** Выбор провайдера осуществляется по `model`. Если несколько провайдеров поддерживают модель, сортировка идет по `priority` (asc), затем по `averageLatency` (asc).
- **Fallback:** Если провайдер возвращает 5xx, он помечается `unhealthy` (errorCount > 3). Восстановление через 30 секунд.

## 5. Serving / Config
- **Запуск:** Docker Compose (Node.js 20 Alpine).
- **Конфигурация:** В PoC провайдеры захардкожены в `platform.ts`. В проде — через API `/api/registry/providers`.
- **Секреты:** Bearer токены передаются в заголовках.

## 6. Observability / Evals
- **Метрики (Prometheus):**
  - `agent_platform_requests_total` (Counter)
  - `agent_platform_response_latency_seconds` (Histogram)
  - `agent_platform_ttft_seconds` (Histogram)
  - `agent_platform_tpot_seconds` (Histogram)
  - `agent_platform_tokens_total` (Counter)
  - `agent_platform_cost_usd_total` (Counter)
- **Логи:** Консольный вывод при изменении Health-статуса провайдеров.
