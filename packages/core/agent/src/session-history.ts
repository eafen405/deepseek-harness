/**
 * Host-callable Session history and follow continuity: the process-local
 * assistant-stream reconnect baseline plus a durable event cursor that reports
 * a gap instead of publishing a corrupted continuation.
 *
 * This is the narrow seam a Host plugin uses to reuse the native fold without
 * mounting the API session controller, a Client, or a Remote transport.
 *
 * @module @deepseek-ai/dsh-agent/session-history
 */

import type { Context } from '@deepseek-ai/cordis'
import { AssistantStreamAccumulator } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionId, SessionLogOffset, SessionSeqCursor } from '@deepseek-ai/dsh-session'
import type { AssistantStreamFrame } from './runtime-types.ts'

/** One active assistant attempt in a reconnect baseline. */
export interface SessionAssistantStreamAttempt {
  /** Attempt identity within the live Agent lifecycle. */
  readonly attemptId: AssistantStreamFrame['attemptId']
  /** Last durable Session seq observed when this attempt started. */
  readonly startedAfterSeq: SessionSeqCursor
  /** Durable turn owning the attempt. */
  readonly turn: number
  /** Durable step owning the attempt. */
  readonly step: number
  /** Dense position expected for the next live chunk frame. */
  readonly nextIndex: number
  /** Compact stream accumulated at this revision. */
  readonly stream: readonly AssistantStreamRecord[]
}

/** Complete process-local assistant state at one read. */
export interface SessionAssistantStreamBaseline {
  /** Last accepted frame revision; 0 before any frame. */
  readonly revision: number
  /** Present only while one attempt is still streaming. */
  readonly activeAttempt?: SessionAssistantStreamAttempt
}

/** One read of a Session's process-local assistant state. */
export interface SessionAssistantStreamRead {
  /** Current baseline; an identity-stable value until another frame is accepted. */
  readonly baseline: SessionAssistantStreamBaseline
  /**
   * Whether the fold lost continuity and dropped its active attempt: a
   * follower must reopen its stream instead of extending what it holds.
   */
  readonly needsResync: boolean
}

interface MutableAttempt {
  readonly attemptId: SessionAssistantStreamAttempt['attemptId']
  readonly startedAfterSeq: SessionSeqCursor
  readonly turn: number
  readonly step: number
  readonly stream: AssistantStreamAccumulator
  nextIndex: number
}

const EMPTY_BASELINE: SessionAssistantStreamBaseline = { revision: 0 }

/**
 * Folds dense Agent frames and materializes one shared immutable reconnect
 * baseline per accepted revision.
 */
export class SessionAssistantStreamAccumulator {
  private activeAttempt: MutableAttempt | undefined
  private revision = 0
  private snapshotValue: SessionAssistantStreamBaseline = EMPTY_BASELINE
  private dirty = false
  private resync = false

  /** Whether the last accepted frame broke revision, identity, or dense-index continuity. */
  get needsResync(): boolean {
    return this.resync
  }

  /**
   * Fold one trusted frame from the current attached Agent lifecycle.
   * @param frame - next dense process-local Assistant frame.
   * @param durableCursor - last committed Session seq when this frame was observed.
   */
  accept(frame: AssistantStreamFrame, durableCursor: SessionSeqCursor): void {
    if (frame.type === 'start' && frame.revision === 1 && this.revision !== 0) {
      this.activeAttempt = undefined
      this.revision = 0
    }
    if (frame.revision !== this.revision + 1) {
      this.activeAttempt = undefined
      this.revision = frame.revision
      this.dirty = true
      this.resync = true
      return
    }
    this.revision = frame.revision
    switch (frame.type) {
      case 'start':
        this.activeAttempt = {
          attemptId: frame.attemptId,
          startedAfterSeq: durableCursor,
          turn: frame.turn,
          step: frame.step,
          stream: new AssistantStreamAccumulator(),
          nextIndex: 0,
        }
        this.resync = false
        break
      case 'chunk': {
        const attempt = this.activeAttempt
        if (attempt === undefined
          || attempt.attemptId !== frame.attemptId
          || frame.index !== attempt.nextIndex) {
          this.activeAttempt = undefined
          this.resync = true
          break
        }
        attempt.stream.push({ time: frame.time, chunk: frame.chunk })
        attempt.nextIndex += 1
        this.resync = false
        break
      }
      case 'end':
        this.activeAttempt = undefined
        this.resync = false
        break
    }
    this.dirty = true
  }

  /**
   * Read the cached reconnect baseline, materializing it after a state change.
   * @returns the identity-stable baseline for the latest accepted revision.
   */
  snapshot(): SessionAssistantStreamBaseline {
    if (!this.dirty) return this.snapshotValue
    this.snapshotValue = {
      revision: this.revision,
      ...this.activeAttempt === undefined ? {} : {
        activeAttempt: {
          attemptId: this.activeAttempt.attemptId,
          startedAfterSeq: this.activeAttempt.startedAfterSeq,
          turn: this.activeAttempt.turn,
          step: this.activeAttempt.step,
          nextIndex: this.activeAttempt.nextIndex,
          stream: this.activeAttempt.stream.snapshot(),
        },
      },
    }
    this.dirty = false
    return this.snapshotValue
  }
}

/** A durable event cursor skipped one or more committed sequences. */
export class SessionHistoryGapError extends Error {
  /**
   * @param expectedSeq - next contiguous Session seq the cursor requires.
   * @param receivedSeq - seq the caller offered instead.
   */
  constructor(
    readonly expectedSeq: number,
    readonly receivedSeq: number,
  ) {
    super(`session event stream skipped seq ${String(expectedSeq)}; next event is ${String(receivedSeq)}`)
    this.name = 'SessionHistoryGapError'
  }
}

/**
 * Durable event cursor for one followed Session.
 *
 * A cursor yields a contiguous run: an already-seen seq is ignored, the next
 * seq is accepted, and a later seq raises {@link SessionHistoryGapError} so the
 * caller repairs by reopening follow from a fresh cut instead of publishing a
 * page that pretends the missing events never existed.
 */
export class SessionEventCursor {
  private last: SessionSeqCursor

  /**
   * @param cursor - last committed seq the caller already holds; -1 before any event.
   */
  constructor(cursor: SessionSeqCursor = -1) {
    this.last = cursor
  }

  /** Last seq accepted or reset to, or -1 before the first event. */
  get cursor(): SessionSeqCursor {
    return this.last
  }

  /** Next contiguous seq this cursor requires. */
  get expectedSeq(): number {
    return this.last + 1
  }

  /**
   * Offer one durable event position in delivery order.
   * @param seq - committed Session seq of the delivered event.
   * @returns false for a seq already spanned by this cursor; true after advancing it.
   * @throws {SessionHistoryGapError} when seq is beyond the next contiguous position.
   */
  accept(seq: SessionSeq): boolean {
    if (seq < this.expectedSeq) return false
    if (seq > this.expectedSeq) throw new SessionHistoryGapError(this.expectedSeq, seq)
    this.last = seq
    return true
  }

  /**
   * Move the cursor to a repaired cut without accepting an event.
   * @param cursor - last committed seq the caller now holds; -1 before any event.
   */
  reset(cursor: SessionSeqCursor): void {
    this.last = cursor
  }
}

/**
 * Durable seq immediately before the Session's next append.
 * @param nextSeq - the Session's next append position (`session.seq`).
 * @returns the last committed seq, or -1 for an empty log.
 */
export function cursorBeforeNext(nextSeq: SessionLogOffset): SessionSeqCursor {
  return nextSeq === 0 ? -1 : SessionSeq(nextSeq - 1)
}

/** Host-callable reader of process-local assistant state for one Session. */
export interface SessionHistorySeam extends Disposable {
  /**
   * Read the assistant-stream baseline for one Session.
   * @param sessionId - Session whose process-local frames were observed.
   * @returns the current baseline plus whether continuity was lost.
   */
  assistantStream(sessionId: SessionId): SessionAssistantStreamRead
  /**
   * Create a durable event cursor over committed Session seqs.
   * @param cursor - last committed seq the caller already holds; -1 before any event.
   * @returns a cursor that ignores replays and reports gaps.
   */
  eventCursor(cursor?: SessionSeqCursor): SessionEventCursor
}

/**
 * Observe process-local assistant frames for every Session in this context and
 * expose the fold through a narrow, synchronously readable seam.
 *
 * State is per Session: a disposed Agent drops its baseline, exactly as the
 * controller's reconnect snapshot does. Disposing the returned seam removes
 * both listeners; callers own one seam per consumer.
 * @param ctx - Host context whose `agent/*` publications supply the frames.
 * @returns the seam reader plus its listener disposer.
 */
export function createSessionHistorySeam(ctx: Context): SessionHistorySeam {
  const streams = new Map<SessionId, SessionAssistantStreamAccumulator>()
  const disposeFrame = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    let stream = streams.get(agent.session.id)
    if (stream === undefined) {
      stream = new SessionAssistantStreamAccumulator()
      streams.set(agent.session.id, stream)
    }
    stream.accept(frame, cursorBeforeNext(agent.session.seq))
  }, { global: true })
  const disposeDisposed = ctx.on('agent/disposed', ({ agent }) => {
    streams.delete(agent.session.id)
  }, { global: true })
  return {
    assistantStream(sessionId) {
      const stream = streams.get(sessionId)
      return stream === undefined
        ? { baseline: EMPTY_BASELINE, needsResync: false }
        : { baseline: stream.snapshot(), needsResync: stream.needsResync }
    },
    eventCursor(cursor) {
      return new SessionEventCursor(cursor)
    },
    [Symbol.dispose]() {
      disposeFrame()
      disposeDisposed()
      streams.clear()
    },
  }
}
