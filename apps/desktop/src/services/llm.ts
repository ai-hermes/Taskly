/**
 * LLM-based todo extraction.
 *
 * The provider implementation now lives in `@taskly/core` so it can be shared
 * with the Taskly CLI. Re-exported here to preserve the existing import path
 * (`@/services/llm`).
 */
export { OpenAIProvider, EXTRACT_PROMPT } from "@taskly/core";
export type { OpenAIProviderOptions } from "@taskly/core";
