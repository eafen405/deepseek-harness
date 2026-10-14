/**
 * A principal Peer: one product-level identity admitted by a registered
 * second-credential authenticator. Connection owns one scope per principal and
 * disposes it when the principal is revoked or its authenticator is removed,
 * which is what closes the sockets admitted as it.
 * @module @deepseek-ai/dsh-client-connection/src/principal-peer
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { PeerId, PeerScope } from '@deepseek-ai/dsh-typert-protocol'

/** One principal's scope; the instance is its own scope key, as for the operator. */
export class PrincipalPeer implements PeerScope {
  readonly id: PeerId = randomUUID() as PeerId
  readonly ctx: Context
  private readonly scope: Scope
  private disposed = false

  /**
   * @param owner - Connection plugin context the scope fiber hangs under.
   * @param principalId - product-level principal key this scope speaks for.
   */
  constructor(owner: Context, readonly principalId: string) {
    this.scope = createScope(owner, this)
    this.ctx = this.scope.ctx
  }

  /** Tear down every connection-lifetime registration; racing calls share one completion. */
  dispose(): Promise<void> {
    this.disposed = true
    return this.scope.dispose()
  }

  /** Whether this scope has already been disposed. */
  get isDisposed(): boolean {
    return this.disposed
  }
}
