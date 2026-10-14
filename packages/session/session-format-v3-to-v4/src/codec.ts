/** V4 framing with native tool-role admission and released physical rows. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCodec, SessionFormatCurrentEncoder, SessionFormatHeader, SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { releasedV2SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertV4SourceRowAdmission } from './message-sources.ts'
import { assertV4RetiredSyntax } from './retired-syntax.ts'
import { assertV4SystemMessageFields } from './system-message.ts'
import { assertV4DeveloperData } from './developer.ts'
import { assertV4ForkResult } from './fork-result.ts'
import { assertV4ToolResultMessage } from './tool-role.ts'
import { assertReleasedV4Header } from './validation.ts'

/** The one physical header key V4 owns beyond the released v2 framing. */
const V4_OWNER_KEY = 'owner'

/**
 * Admit one physical V4 header row and detach its V4-owned key, leaving exactly
 * the released v2 row the frozen codec still owns. Without this strip the
 * frozen v2 exact-key admission refuses a v4 header that carries `owner`.
 * @param value - untrusted physical header row.
 * @returns the row as a released v2 physical header (never carrying `owner`).
 */
function releasedV2PhysicalRow(value: unknown): SessionFormatJsonObject {
  if (!isSessionFormatJsonObject(value) || value['version'] !== 4 || value['type'] !== 'session') {
    throw new SessionFormatError('expected format v4 physical Session header')
  }
  const { [V4_OWNER_KEY]: _owner, ...rest } = value
  return { ...rest, version: 2 }
}

/**
 * Decode one physical V4 header: the frozen v2 codec admits the shared keys,
 * while V4 admits and validates its own extension and restores it afterwards.
 * @param value - untrusted physical header row.
 * @returns the validated logical V4 header.
 */
function decodePhysicalV4Header(value: unknown): SessionFormatHeader {
  const owner = isSessionFormatJsonObject(value) ? value[V4_OWNER_KEY] : undefined
  const header = {
    ...releasedV2SessionFormatCodec.decodeHeader(releasedV2PhysicalRow(value)),
    version: 4,
    ...owner === undefined ? {} : { owner },
  } as SessionFormatHeader
  assertReleasedV4Header(header)
  return header
}

/**
 * V4 physical encoder and decoder retain the released row framing while
 * validating the native tool-role message directly and owning the `owner`
 * header extension themselves (the frozen v2 contract stays untouched).
 */
export const releasedV4SessionFormatCodec = Object.freeze({
  version: 4,
  decodeHeader(value: unknown) {
    return decodePhysicalV4Header(value)
  },
  createDecoder(value, recovery) {
    const decoder = releasedV2SessionFormatCodec.createDecoder(releasedV2PhysicalRow(value), recovery)
    return {
      ...decoder,
      header: decodePhysicalV4Header(value),
      decodeRow(row, context) {
        assertV4RowAdmission(row)
        decoder.decodeRow(row, {
          emitRun: context.emitRun.bind(context),
          emitEvent: context.emitEvent.bind(context),
        })
      },
    }
  },
  encodeHeader(header, inheritedEventCount) {
    assertReleasedV4Header(header)
    const { [V4_OWNER_KEY]: owner, ...shared } = header
    return {
      ...releasedV2SessionFormatCodec.encodeHeader({ ...shared, version: 2 }, inheritedEventCount),
      version: 4,
      ...owner === undefined ? {} : { [V4_OWNER_KEY]: owner },
    }
  },
  encodeEvent(event: SessionFormatEvent) {
    if (event.type === 'developer/message' && event['ignorable'] === true) {
      assertV4DeveloperData(event)
      assertV4RetiredSyntax(event)
    }
    assertV4RowAdmission(event)
    return releasedV2SessionFormatCodec.encodeEvent(event)
  },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)

/**
 * Apply native V4 admission before a scanner discards a recoverable suffix.
 * Ignorable developer payloads require reader vocabulary; physical decoding defers them.
 * @param row - parsed physical row before framing and source-event range decoding.
 * @param knownEventTypes - installed event types, supplied by native readers before tail recovery.
 */
export function assertV4RowAdmission(row: unknown, knownEventTypes?: ReadonlySet<string>): void {
  if (isSessionFormatJsonObject(row)) {
    if (row['type'] === 'developer/message' && row['ignorable'] === true
      && knownEventTypes?.has('developer/message') !== true) return
    assertV4DeveloperData(row as unknown as SessionFormatEvent)
  }
  assertV4SourceRowAdmission(row)
  assertV4RetiredSyntax(row)
  assertV4SystemMessageFields(row)
  if (!isSessionFormatJsonObject(row) || row['type'] !== 'tool/result') return
  const event = row as unknown as SessionFormatEvent
  assertV4ToolResultMessage(event)
  assertV4ForkResult(event)
}
