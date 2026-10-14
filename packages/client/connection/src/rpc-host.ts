/** Host registry and HTTP adapter for generic Connection RPC channels. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import {
  RpcId,
  type ClientRequest,
  type RpcId as RpcIdType,
} from './rpc.ts'
import { clientRequestSchema } from './rpc-schema.ts'
import { bridge } from './http-bridge.ts'
import { isRemoteAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import type { BrowserAuth } from './browser-auth.ts'
import { OperatorPeer } from './operator-peer.ts'
import { PrincipalPeer } from './principal-peer.ts'
import type {
  PeerAdmission,
  ConnectionAuthenticator,
  ConnectionAuthenticatorRegistration,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionFetchRoute,
  ConnectionFetchHandler,
  ConnectionPrincipal,
  ConnectionTrustRequest,
  HostConnectionAuthenticators,
  HostConnectionFetch,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcResult,
  ConnectionRequestRejection,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly fetchHandler: ConnectionFetchHandler
}

interface RegisteredFetchRoute {
  readonly methods: ReadonlySet<string>
  readonly requestBody: ConnectionFetchRoute['requestBody']
  readonly fetch: ConnectionFetchRoute['fetch']
}

interface ConnectionServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
}

/** One registered authenticator and the principals only it has vouched for so far. */
interface RegisteredAuthenticator {
  readonly authenticator: ConnectionAuthenticator
  readonly principals: Set<string>
}

/** One live principal Peer and the authenticators that have identified it. */
interface PrincipalRecord {
  readonly peer: PrincipalPeer
  readonly principal: ConnectionPrincipal
  readonly authenticators: Set<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  /** The operator Peer the browser cookie speaks for. */
  readonly operator: PeerScope
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()
  private readonly fetchRoutes = new Map<string, RegisteredFetchRoute>()
  private readonly registeredAuthenticators = new Map<string, RegisteredAuthenticator>()
  private readonly principals = new Map<string, PrincipalRecord>()
  private readonly peersById = new Map<PeerId, PrincipalRecord>()

  readonly allowsRemoteAuthorities: boolean

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by the Host/Origin fence.
   * @param browserAuth - process token and persistent browser-session owner.
   */
  constructor(
    ctx: Context,
    private readonly trustedHosts: readonly string[],
    private readonly browserAuth: BrowserAuth,
  ) {
    super(ctx, 'connection')
    this.operator = new OperatorPeer(ctx)
    ctx.effect(() => () => this.operator.dispose(), 'client-connection: operator Peer')
    this.allowsRemoteAuthorities = trustedHosts.some(isRemoteAuthority)
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc {
    const owner = this.ctx
    return {
      handle: (channel, handler) => this.register(owner, channel, handler),
      intercept: (channel, matches, handler) =>
        this.registerInterceptor(owner, channel, matches, handler),
    }
  }

  /** Exact Fetch-route registry scoped to the Context reading this service. */
  get fetch(): HostConnectionFetch {
    const owner = this.ctx
    return {
      register: route => this.registerFetchRoute(owner, route),
    }
  }

  /** Second-credential authenticator registry scoped to this Connection. */
  get authenticators(): HostConnectionAuthenticators {
    const owner = this.ctx
    return {
      register: authenticator => this.registerAuthenticator(owner, authenticator),
    }
  }

  /** Apply only the Host/Origin fence; product-owned public routes authenticate themselves. */
  fence(request: ConnectionTrustRequest): 403 | undefined {
    const carrier = this.ctx.get('webServer')
    return isTrustedApiRequest(request, this.trustedHosts, carrier?.host, carrier?.protocol ?? 'http:')
      ? undefined
      : 403
  }

  /** Apply the Host/Origin fence, then any credential the request carries. */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
    const fenced = this.fence(request)
    if (fenced !== undefined) return fenced
    return this.admittedPeer(request) === undefined ? 401 : undefined
  }

  /** A request that passes the fence and carries a credential speaks for its Peer. */
  admit(request: ConnectionTrustRequest): PeerAdmission {
    const fenced = this.fence(request)
    if (fenced !== undefined) return { rejection: fenced }
    const peer = this.admittedPeer(request)
    return peer === undefined ? { rejection: 401 } : { peer }
  }

  /** The principal a Peer speaks for; the operator and unknown Peers have none. */
  principalOf(peer: PeerScope): ConnectionPrincipal | undefined {
    return this.peersById.get(peer.id)?.principal
  }

  /** Dispose one principal's Peer scope; its next identified request mints a fresh one. */
  async revokePrincipal(principalId: string): Promise<void> {
    const record = this.principals.get(principalId)
    if (record === undefined) return
    this.forget(record)
    await record.peer.dispose()
  }

  /** Drop every registry entry for one principal record. */
  private forget(record: PrincipalRecord): void {
    this.principals.delete(record.principal.id)
    this.peersById.delete(record.peer.id)
    for (const registered of this.registeredAuthenticators.values()) {
      registered.principals.delete(record.principal.id)
    }
  }

  /**
   * Resolve the Peer one fenced request speaks for: the browser cookie keeps
   * admitting as the operator, and otherwise the first registered
   * authenticator that identifies a principal decides.
   */
  private admittedPeer(request: ConnectionTrustRequest): PeerScope | undefined {
    const secure = this.ctx.get('webServer')?.protocol === 'https:'
    if (this.browserAuth.isAuthenticated(request, secure)) return this.operator
    for (const registered of this.registeredAuthenticators.values()) {
      const principal = registered.authenticator.identify(request)
      if (principal === undefined) continue
      assertPrincipal(principal, registered.authenticator.name)
      return this.principalPeer(principal, registered.authenticator.name)
    }
    return undefined
  }

  /** Get or create the Peer for one principal, recording which authenticators vouch for it. */
  private principalPeer(principal: ConnectionPrincipal, authenticatorName: string): PrincipalPeer {
    const existing = this.principals.get(principal.id)
    if (existing !== undefined) {
      existing.authenticators.add(authenticatorName)
      this.registeredAuthenticators.get(authenticatorName)?.principals.add(principal.id)
      return existing.peer
    }
    const peer = new PrincipalPeer(this.ctx, principal.id)
    const record: PrincipalRecord = {
      peer,
      principal: { id: principal.id },
      authenticators: new Set([authenticatorName]),
    }
    this.principals.set(principal.id, record)
    this.peersById.set(peer.id, record)
    this.registeredAuthenticators.get(authenticatorName)?.principals.add(principal.id)
    return peer
  }

  private registerAuthenticator(
    owner: Context,
    authenticator: ConnectionAuthenticator,
  ): ConnectionAuthenticatorRegistration {
    assertAuthenticator(authenticator)
    if (this.registeredAuthenticators.has(authenticator.name)) {
      throw new Error(`connection: authenticator ${JSON.stringify(authenticator.name)} is already registered`)
    }
    const registered: RegisteredAuthenticator = { authenticator, principals: new Set() }
    this.registeredAuthenticators.set(authenticator.name, registered)
    let disposed = false
    const dispose = async (): Promise<void> => {
      if (disposed) return
      disposed = true
      this.registeredAuthenticators.delete(authenticator.name)
      const orphaned: Promise<void>[] = []
      for (const principalId of registered.principals) {
        const record = this.principals.get(principalId)
        if (record === undefined) continue
        record.authenticators.delete(authenticator.name)
        if (record.authenticators.size > 0) continue
        this.forget(record)
        orphaned.push(record.peer.dispose())
      }
      await Promise.all(orphaned)
    }
    owner.effect(() => () => dispose(), `client-connection: ${authenticator.name} authenticator`)
    return { dispose }
  }

  /**
   * Authenticate an index request; native TLS listeners mint Secure cookies.
   */
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean {
    return this.browserAuth.authorizeIndex(request, response, this.ctx.get('webServer')?.protocol === 'https:')
  }

  /** Add this process's launch token to the clean application URL. */
  authenticatedUrl(baseUrl: string): string {
    return this.browserAuth.authenticatedUrl(baseUrl)
  }

  /**
   * Compose one shared-channel Fetch handler from exact routes and its interceptor.
   * @param channel - shared channel mounted by Connection.
   * @returns Fetch handler that selects one owner or returns 404.
   */
  createSharedFetchHandler(
    channel: '/api',
  ): ConnectionFetchHandler {
    return {
      requestBodyMode: ({ method, url }) => {
        const route = this.fetchRoutes.get(url.pathname)
        return route?.methods.has(method) === true ? route.requestBody : 'buffered'
      },
      fetch: (request) => {
        const pathname = new URL(request.url).pathname
        const route = this.fetchRoutes.get(pathname)
        if (route?.methods.has(request.method) === true) return route.fetch(request)
        const endpoint = endpointFromPath(channel, pathname)
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        return interceptor.fetchHandler.fetch(request)
      },
    }
  }

  private registerFetchRoute(
    owner: Context,
    route: ConnectionFetchRoute,
  ): () => Promise<void> {
    assertFetchRoute(route)
    const registered: RegisteredFetchRoute = {
      methods: new Set(route.methods),
      requestBody: route.requestBody,
      fetch: route.fetch,
    }
    return owner.effect(() => {
      if (this.fetchRoutes.has(route.path)) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
      }
      this.fetchRoutes.set(route.path, registered)
      return () => { this.fetchRoutes.delete(route.path) }
    }, `client-connection: ${route.path} Fetch route`)
  }

  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    assertChannel(channel)
    const fetchHandler = rpcFetchHandler(channel, handler, this.operator)
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      handler: async (req, res) => {
        const admission = this.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        await bridge(req, res, fetchHandler)
      },
    }
    return owner.effect(
      () => owner.webServer.register(route),
      `client-connection: ${channel} rpc channel`,
    )
  }

  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = {
      matches,
      fetchHandler: rpcFetchHandler(channel, handler, this.operator),
    }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => {
        this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
  peer: PeerScope,
): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request: Request): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'gateway/bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        const result = await handler(endpoint, message.payload, request.signal, peer)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

function invalidEnvelopeResponse(body: unknown, issues: readonly object[]): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'gateway/bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: ConnectionRpcFailure): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: Awaited<ReturnType<ConnectionRpcHandler>>): Response {
  if (!result.ok) {
    const body: ConnectionServerResponse = { type: 'server-response', rpcId, result }
    return Response.json(body)
  }
  const { attachments, ...success } = result
  const body: ConnectionServerResponse = { type: 'server-response', rpcId, result: success }
  if (attachments === undefined || attachments.length === 0) return Response.json(body)
  const parts = new FormData()
  const attachmentMetadata = attachments.map((attachment, index) => {
    const part = `bytes-${index}`
    // FileSystem bytes may have SharedArrayBuffer backing, which BlobPart excludes.
    parts.set(part, new Blob([new Uint8Array(attachment.bytes)]))
    return { path: [...attachment.path], codec: 'bytes' as const, part }
  })
  parts.set('metadata', JSON.stringify({ ...body, attachments: attachmentMetadata }))
  return new Response(parts)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}

function assertAuthenticator(authenticator: ConnectionAuthenticator): void {
  if (typeof authenticator.name !== 'string' || authenticator.name.trim() === '') {
    throw new Error('connection: an authenticator needs a non-empty name')
  }
  if (typeof authenticator.identify !== 'function') {
    throw new Error(`connection: authenticator ${JSON.stringify(authenticator.name)} has no identify function`)
  }
}

function assertPrincipal(principal: ConnectionPrincipal, authenticatorName: string): void {
  if (typeof principal.id !== 'string' || principal.id === '') {
    throw new Error(
      `connection: authenticator ${JSON.stringify(authenticatorName)} identified a principal without a non-empty id`,
    )
  }
}

function assertFetchRoute(route: ConnectionFetchRoute): void {
  if (endpointFromPath(API_PATH, route.path) === undefined) {
    throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`)
  }
  if (route.methods.length === 0) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`)
  }
  const methods = new Set(route.methods)
  if (methods.size !== route.methods.length) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`)
  }
}
