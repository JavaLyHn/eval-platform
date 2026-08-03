import { registerProvider } from "../registry";
import { mockProvider } from "./mock";
import { platformProvider } from "./platform";
import { gatewayProvider } from "./gateway";
import { openaiCompatProvider } from "./openai-compat";
import { newapiProvider } from "./newapi";
import { anthropicProvider } from "./anthropic";

let initialized = false;

/** Register every built-in provider. Idempotent. */
export function registerBuiltinProviders(): void {
  if (initialized) return;
  initialized = true;
  registerProvider(mockProvider);
  registerProvider(platformProvider);
  registerProvider(gatewayProvider);
  registerProvider(openaiCompatProvider);
  registerProvider(newapiProvider);
  registerProvider(anthropicProvider);
}
