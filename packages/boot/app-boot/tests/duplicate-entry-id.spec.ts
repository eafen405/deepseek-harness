/**
 * A loader entry id is global inside its tree. Reusing an id for a nested
 * group used to make the same `Entry` act as both parent and child; the
 * `disabled` getter then walked a cyclic parent chain forever (100% CPU, no
 * output) instead of failing the boot.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import { afterAll, describe, expect, it } from 'vitest'
import { boot } from '../src/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'dsh-duplicate-entry-id-'))
writeFileSync(join(dir, 'noop.mjs'), 'export function apply() {}\n')
writeFileSync(join(dir, 'cordis.yml'), '[]\n')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('loader entry structure', () => {
  it('rejects a duplicate id in the composed patch list before mounting', async () => {
    const patches = [{
      insert: [{
        id: 'kernel',
        name: 'cordis:group',
        group: true,
        config: [{
          id: 'kernel',
          name: 'cordis:group',
          group: true,
          config: [],
        }],
      }],
    }]

    let failure: unknown
    try {
      await boot('dsh-test-bin', join(dir, 'cordis.yml'), patches)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/duplicate loader entry id "kernel"/)
  })

  it('refuses to move an entry under its own group at the loader seam', async () => {
    const ctx = new Context()
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = Group
    try {
      const id = await ctx.loader.create({
        id: 'kernel',
        name: 'cordis:group',
        group: true,
        config: [],
      })
      const entry = ctx.loader.resolve(id)
      await expect(entry.subgroup!.create({
        id: 'kernel',
        name: 'cordis:group',
        group: true,
        config: [],
      })).rejects.toThrow(/cannot be moved under itself/)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
