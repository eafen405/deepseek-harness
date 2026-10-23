/**
 * dsh-jobs' owned branded ids, carried across the registry, the model-facing
 * control surface, and the client wire.
 *
 * It lives in its own leaf because the package root and `./types` both reach
 * `dsh-agent` through the owner and listener signatures, which a Client program
 * cannot resolve even as a type. A browser-safe consumer imports the id here;
 * `Branded<B>` itself comes from the zero-dependency `@deepseek-ai/dsh-brand`.
 *
 * @module @deepseek-ai/dsh-jobs/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Identifies one job across registry lifetimes. The registry generates `<kind>-<short-uuid>`;
 * access still requires owner authorization.
 */
export type JobId = Branded<'JobId'>

/**
 * Brand a string as a {@link JobId}.
 * @param id - the raw job-id string (the registry generates 16 UUID hex characters after the kind).
 * @returns the same string, branded; no validation is performed.
 */
export function JobId(id: string): JobId {
  return id as JobId
}

/** Identifies one process-local job registry generation. */
export type JobGeneration = Branded<'JobGeneration'>

/**
 * Brand a registry generation UUID without validation.
 * @param generation - the registry-issued UUID.
 * @returns the same string, branded.
 */
export function JobGeneration(generation: string): JobGeneration {
  return generation as JobGeneration
}
