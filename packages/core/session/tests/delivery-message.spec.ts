import { describe, expect, it } from 'vitest'
import {
  DeliveryId,
  KNOWN_SESSION_EVENT_TYPES,
  SessionId,
  SessionOwnerId,
  SessionSeq,
  deriveEventMessage,
  foldSurface,
  isSurfaceEligibleType,
} from '@deepseek-ai/dsh-session'
import type { DeliveryAttachmentRef, SessionEvent } from '@deepseek-ai/dsh-session'
import { validateSessionEventData, validateSurfaceMetadata } from '@deepseek-ai/dsh-session/surface'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'

const deliveryId = DeliveryId('delivery-1')
const sender = SessionId('session-sender')

/** One delivered assistant message from a non-model source. */
function deliveredMessage() {
  return createAssistantMessage({
    content: [{ type: 'text', text: 'hello from the sending fairy' }],
    source: { deliveryId: deliveryId as string, senderSessionId: sender as string },
  })
}

/** One complete delivery surface event as the product appends it. */
function deliveryEvent(seq = 0): SessionEvent {
  return {
    type: 'delivery/message',
    seq: SessionSeq(seq),
    time: 1,
    data: {
      deliveryId,
      origin: { sessionId: sender, owner: SessionOwnerId('alice') },
      message: deliveredMessage(),
      attachments: [{ attachmentId: 'attachment-1', name: 'note.txt', bytes: 3 } as DeliveryAttachmentRef],
    },
    surfaceOp: 'append',
  } as SessionEvent
}

describe('delivery/message', () => {
  it('derives an assistant message from a non-model delivery source', () => {
    const event = deliveryEvent()
    expect(isSurfaceEligibleType('delivery/message')).toBe(true)
    const message = deriveEventMessage(event)
    expect(message?.role).toBe('assistant')
    expect(message?.source.kind).toBe('delivered-message')
    expect(message?.content).toEqual([{ type: 'text', text: 'hello from the sending fairy' }])
    expect(foldSurface([event]).nodes).toEqual([event.seq])
  })

  it('carries no fabricated model turn, step, or stream field', () => {
    const event = deliveryEvent()
    for (const key of ['turn', 'step', 'stream']) {
      expect(Object.hasOwn(event.data, key)).toBe(false)
    }
    for (const key of ['turn', 'step', 'stream']) {
      expect(() => {
        validateSessionEventData(
          { type: 'delivery/message', data: { ...event.data, [key]: 1 } as never },
          'delivery/message at seq 0',
        )
      }).toThrow(new RegExp(key))
    }
  })

  it('is required vocabulary rather than an ignorable record', () => {
    expect(KNOWN_SESSION_EVENT_TYPES.has('delivery/message')).toBe(true)
  })

  it('forbids citing source events, exactly like an embedded assistant message', () => {
    const event = deliveryEvent()
    expect(() => { validateSurfaceMetadata({ ...event, sourceEventSeqs: [SessionSeq(0)] } as never) })
      .toThrow(/sourceEventSeqs/)
  })

  it('refuses a payload whose delivery identity and message source disagree', () => {
    const event = deliveryEvent()
    expect(() => {
      validateSessionEventData(
        { type: 'delivery/message', data: { ...event.data, deliveryId: DeliveryId('other') } as never },
        'delivery/message at seq 0',
      )
    }).toThrow(/deliveryId/)
    expect(() => {
      validateSessionEventData(
        {
          type: 'delivery/message',
          data: { ...event.data, message: { ...event.data.message, role: 'user' } } as never,
        },
        'delivery/message at seq 0',
      )
    }).toThrow(/assistant/)
  })
})
