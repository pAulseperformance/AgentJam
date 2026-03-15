/**
 * Typed Worker environment bindings.
 * Rule: All Worker env bindings must be validated at startup.
 */
export interface Env {
  JAM_ROOM: DurableObjectNamespace;
}

/**
 * Validate that all required bindings are present.
 * Call this at the start of the Worker's fetch handler.
 */
export function validateEnv(env: unknown): asserts env is Env {
  const e = env as Record<string, unknown>;
  if (!e['JAM_ROOM']) {
    throw new Error('[ENV] Missing required binding: JAM_ROOM (DurableObjectNamespace)');
  }
}
