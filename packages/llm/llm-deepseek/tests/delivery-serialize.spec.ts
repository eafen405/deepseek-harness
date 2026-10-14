/** Durable replay and request conversion for a delivered, non-model assistant message. */
import { describe, expect, it } from 'vitest'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { resolveAdapterOptions } from '../src/config.ts'
import { readReplay } from '../src/replay.ts'
import { serialize } from '../src/serialize.ts'
import { MODEL, options, user } from './helpers.ts'

const connection = resolveAdapterOptions({})

/** One assistant-role message delivered from another Session instead of a model call. */
const delivered = createAssistantMessage({
  content: [{ type: 'text', text: 'delivered body' }],
  source: { deliveryId: 'delivery-1', senderSessionId: 'session-sender' },
})

describe('delivered messages', () => {
  it('carries a delivered source rather than a model source', () => {
    expect(delivered.source.kind).toBe('delivered-message')
  })

  it('has no provider replay state', () => {
    expect(readReplay(delivered, MODEL)).toBeUndefined()
  })

  it('still converts its content into the request', () => {
    const messages = [user(), delivered]
    const body = serialize(options({ messages }), connection, messages, new Map(), () => undefined)
    expect(JSON.stringify(body)).toContain('delivered body')
  })
})
