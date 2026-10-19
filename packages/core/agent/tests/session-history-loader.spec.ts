/**
 * REAL-composition proof: the shipped YAML row shape (`dsh-agent` +
 * `dsh-session`) boots through the vendored Loader, and the public
 * `@deepseek-ai/dsh-agent/session-history` export is the seam a product plugin
 * imports from its own package — no loader-visible default export, and the
 * assistant baseline and durable cursor behave for a Session created by the
 * composed tree.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as AgentPlugin from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm'
import * as SessionHistory from '@deepseek-ai/dsh-agent/session-history'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-session-history-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentPlugin],
    ['@deepseek-ai/dsh-session', SessionStore],
    // A product plugin imports the seam by this exact specifier.
    ['@deepseek-ai/dsh-agent/session-history', SessionHistory],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as ModuleLoaderV2
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped agent + session rows and serves the history seam', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-session'",
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const session = loaded.sessions.create(SessionId('composed'))
    using seam = SessionHistory.createSessionHistorySeam(loaded)
    expect(seam.assistantStream(session.id)).toEqual({ baseline: { revision: 0 }, needsResync: false })

    // A live Agent's Session identity is all the seam reads from the frame's subject.
    loaded.emit('agent/assistant-stream', {
      agent: { id: session.id, session } as Agent,
      frame: { type: 'start', attemptId: LlmAttemptId('a'), revision: 1, turn: 1, step: 1 },
    })
    expect(seam.assistantStream(session.id).baseline).toMatchObject({
      revision: 1,
      activeAttempt: { attemptId: 'a', startedAfterSeq: -1 },
    })

    const cursor = seam.eventCursor()
    session.append('turn/start', { turn: 1 })
    for (const event of session.snapshotEvents()) expect(cursor.accept(event.seq)).toBe(true)
    expect(cursor.expectedSeq).toBe(session.seq)
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    // A default export beside the named form makes the Loader discard the
    // namespace (postmortem 0001) — pin its absence for the seam module too.
    expect('default' in SessionHistory).toBe(false)
    expect('createSessionHistorySeam' in SessionHistory).toBe(true)
  })
})
