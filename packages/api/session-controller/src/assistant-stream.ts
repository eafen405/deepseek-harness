/**
 * Process-local assistant state retained for reconnecting Web followers.
 *
 * The fold now lives on the public Host-callable seam
 * `@deepseek-ai/dsh-agent/session-history`; this module keeps the controller's
 * existing subpath imports working without a second implementation.
 */

export {
  cursorBeforeNext,
  SessionAssistantStreamAccumulator,
} from '@deepseek-ai/dsh-agent/session-history'
