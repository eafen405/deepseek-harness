import { Context, Service } from '@deepseek-ai/cordis'
import { Entry, type EntryCreateOptions, type EntryOptions } from './entry.ts'
import { EntryTree } from './tree.ts'
import { EntryStructureError } from './errors.ts'

/** Runtime owner for a list of child loader entries. */
export class EntryGroup {
  static readonly key = Symbol.for('cordis.group')

  public data: EntryOptions[] = []

  constructor(public ctx: Context, public tree: EntryTree) {
    const entry = ctx.fiber.entry
    if (entry) entry.subgroup = this
  }

  get context(): Context {
    return this.ctx
  }

  async create(options: EntryCreateOptions) {
    const id = this.tree.ensureId(options)
    const entry: Entry = this.tree.store[id] ??= new Entry(this.ctx.loader)
    // Moving an entry between groups is supported, but moving it under itself
    // or one of its own descendants makes the parent chain cyclic; the
    // `disabled` walk would then never terminate. Reject the move here.
    const seen = new Set<Entry>()
    for (let owner = this.ctx.fiber.entry; owner && !seen.has(owner); owner = owner.parent?.ctx.fiber.entry) {
      seen.add(owner)
      if (owner === entry) {
        throw new EntryStructureError(
          `loader entry ${JSON.stringify(id)} cannot be moved under itself or one of its descendants`,
        )
      }
    }
    // Entry may be moved from another group,
    // so we need to update the parent reference.
    entry.parent = this
    // Use `create: true` to replace existing entry.options.
    await entry.update(options, true, true)
    return entry.id
  }

  unlink(options: EntryOptions) {
    const config = this.data
    const index = config.indexOf(options)
    if (index >= 0) config.splice(index, 1)
  }

  remove(id: string, isDispose = false) {
    const entry = this.tree.store[id]
    if (!entry) return
    entry.fiber?.dispose()
    if (!isDispose) {
      this.unlink(entry.options)
    }
    delete this.tree.store[id]
    this.context.emit('loader/partial-dispose', entry, entry.options, false)
  }

  async update(config: EntryOptions[]) {
    const oldConfig = this.data as EntryOptions[]
    this.data = config
    const oldMap = Object.fromEntries(oldConfig.map(options => [options.id, options]))
    const newMap = Object.fromEntries(config.map(options => [options.id ?? Symbol('anonymous'), options]))

    // update inner plugins
    const ids = Reflect.ownKeys({ ...oldMap, ...newMap }) as string[]
    await Promise.all(ids.map(async (id) => {
      if (newMap[id]) {
        await this.create(newMap[id]).catch((error) => {
          // A structural error is not a plugin that failed to load: continuing
          // would leave a half-built tree, so let it fail the boot.
          if (error instanceof EntryStructureError) throw error
          this.ctx.logger.error(error)
        })
      } else {
        this.remove(id)
      }
    }))
  }

  stop() {
    for (const options of this.data) {
      this.remove(options.id, true)
    }
  }
}

/** Plugin that mounts a nested loader entry group. */
export class Group extends EntryGroup {
  static initial: Omit<EntryOptions, 'id'>[] = []
  static readonly [EntryGroup.key] = true

  constructor(public ctx: Context, public config: EntryOptions[]) {
    super(ctx, ctx.fiber.entry!.parent.tree)
    ctx.on('internal/update', (config) => {
      this.update(config)
    })
  }

  async* [Service.init]() {
    yield () => this.stop()
    await this.update(this.config)
  }
}
