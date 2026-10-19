/**
 * Behaviour of the public Host-callable Session history seam: the assistant
 * stream reconnect baseline (dense revision/index acceptance, durable cursor
 * alignment) and the durable event cursor that reopens follow on a gap.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm'
import { assembleAssistantStream } from '@deepseek-ai/dsh-llm/assistant-stream'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import {
  SessionEventCursor,
  SessionHistoryGapError,
  createSessionHistorySeam,
} from '@deepseek-ai/dsh-agent/session-history'

function agent(id: string): Agent {
  return { id: SessionId(id), session: { id: SessionId(id), seq: 0 } as Session } as Agent
}

function start(attemptId: string, revision: number, turn = 1, step = 1): AssistantStreamFrame {
  return { type: 'start', attemptId: LlmAttemptId(attemptId), revision, turn, step }
}

function chunk(attemptId: string, revision: number, index: number, text: string): AssistantStreamFrame {
  return {
    type: 'chunk',
    attemptId: LlmAttemptId(attemptId),
    revision,
    index,
    time: revision,
    chunk: { type: 'text-delta', index: 0, text },
  }
}

function textOf(stream: readonly unknown[]): string {
  return assembleAssistantStream(stream as Parameters<typeof assembleAssistantStream>[0])
    .interruptedBlocks()
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('session history seam', () => {
  it('folds dense frames into cumulative assistant text on the shared baseline', () => {
    const ctx = new Context()
    using seam = createSessionHistorySeam(ctx)
    const subject = agent('dense')
    ctx.emit('agent/assistant-stream', { agent: subject, frame: start('a', 1) })
    ctx.emit('agent/assistant-stream', { agent: subject, frame: chunk('a', 2, 0, 'Hel') })
    ctx.emit('agent/assistant-stream', { agent: subject, frame: chunk('a', 3, 1, 'lo') })

    const baseline = seam.assistantStream(subject.session.id).baseline
    expect(baseline.revision).toBe(3)
    expect(baseline.activeAttempt).toMatchObject({ attemptId: 'a', nextIndex: 2 })
    expect(textOf(baseline.activeAttempt?.stream ?? [])).toBe('Hello')
  })

  it('records the durable cursor observed when the attempt started', () => {
    const ctx = new Context()
    using seam = createSessionHistorySeam(ctx)
    const subject = agent('aligned')
    ;(subject.session as { seq: number }).seq = 5
    ctx.emit('agent/assistant-stream', { agent: subject, frame: start('a', 1) })
    ;(subject.session as { seq: number }).seq = 8
    ctx.emit('agent/assistant-stream', { agent: subject, frame: chunk('a', 2, 0, 'x') })
    // `seq` is the next append position, so the last committed seq is 4 at start time and 7 later.
    expect(seam.assistantStream(subject.session.id).baseline.activeAttempt?.startedAfterSeq).toBe(4)
  })

  it('drops a corrupted attempt and reports that the follower must resync after a revision reset', () => {
    const ctx = new Context()
    using seam = createSessionHistorySeam(ctx)
    const subject = agent('reset')
    ctx.emit('agent/assistant-stream', { agent: subject, frame: start('a', 1) })
    ctx.emit('agent/assistant-stream', { agent: subject, frame: chunk('a', 2, 0, 'kept') })
    ctx.emit('agent/assistant-stream', { agent: subject, frame: chunk('a', 4, 1, 'skipped revision') })

    expect(seam.assistantStream(subject.session.id)).toMatchObject({
      baseline: { revision: 4 },
      needsResync: true,
    })
    expect(seam.assistantStream(subject.session.id).baseline.activeAttempt).toBeUndefined()

    ctx.emit('agent/assistant-stream', { agent: subject, frame: start('b', 5) })
    expect(seam.assistantStream(subject.session.id)).toMatchObject({
      baseline: { revision: 5, activeAttempt: { attemptId: 'b' } },
      needsResync: false,
    })
  })

  it('drops a corrupted attempt after a dense-index gap', () => {
    const ctx = new Context()
    using seam = createSessionHistorySeam(ctx)
    const subject = agent('gap')
    ctx.emit('agent/assistant-stream', { agent: subject, frame: start('a', 1) })
    ctx.emit('agent/assistant-stream', { agent: subject, frame: chunk('a', 2, 0, 'one') })
    ctx.emit('agent/assistant-stream', { agent: subject, frame: chunk('a', 3, 2, 'three') })

    expect(seam.assistantStream(subject.session.id)).toMatchObject({
      baseline: { revision: 3 },
      needsResync: true,
    })
    expect(seam.assistantStream(subject.session.id).baseline.activeAttempt).toBeUndefined()
  })

  it('accepts a dense durable cursor and refuses to stretch it across a gap', () => {
    const cursor = new SessionEventCursor(-1)
    expect(cursor.accept(SessionSeq(0))).toBe(true)
    expect(cursor.accept(SessionSeq(1))).toBe(true)
    expect(cursor.accept(SessionSeq(0))).toBe(false)
    expect(() => cursor.accept(SessionSeq(4))).toThrow(SessionHistoryGapError)
    expect(() => cursor.accept(SessionSeq(4))).toThrow('session event stream skipped seq 2')

    cursor.reset(SessionSeq(4))
    expect(cursor.accept(SessionSeq(5))).toBe(true)
  })

  it('reports the gap on the error itself so the caller can choose the repair cut', () => {
    const cursor = new SessionEventCursor(SessionSeq(3))
    try {
      cursor.accept(SessionSeq(9))
      expect.unreachable()
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(SessionHistoryGapError)
      expect(error).toMatchObject({ expectedSeq: 4, receivedSeq: 9 })
    }
  })
})
