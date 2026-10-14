import { describe, expect, it } from 'vitest'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { DeliveryId, SessionId, SessionOwnerId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildSessionEventSearchDocuments, extractSessionEventText } from '@deepseek-ai/dsh-session-query'

const sender = SessionId('session-sender')

/** One delivered message event carrying the searchable delivered body. */
function deliveryEvent(): SessionEvent {
  return {
    type: 'delivery/message',
    seq: SessionSeq(0),
    time: 1,
    data: {
      deliveryId: DeliveryId('delivery-1'),
      origin: { sessionId: sender, owner: SessionOwnerId('alice') },
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'the delivered body is searchable' }],
        source: { deliveryId: 'delivery-1', senderSessionId: sender as string },
      }),
    },
    surfaceOp: 'append',
  } as SessionEvent
}

describe('delivery/message search extraction', () => {
  it('makes the delivered body searchable', () => {
    expect(extractSessionEventText(deliveryEvent())).toBe('the delivered body is searchable')
  })

  it('publishes the delivery as a current-surface search document', () => {
    const documents = buildSessionEventSearchDocuments(SessionId('session-owner'), [deliveryEvent()])
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      seq: 0,
      type: 'delivery/message',
      surface: 'current',
      text: 'the delivered body is searchable',
    })
  })
})
