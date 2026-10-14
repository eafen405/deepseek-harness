/**
 * Second-credential admission: the browser cookie stays the operator's
 * credential, while a registered authenticator lets one request speak for its
 * own principal Peer.
 */
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebServer, WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  apply,
  inject,
  type ConnectionAuthenticator,
  type ConnectionConfig,
  type ConnectionTrustRequest,
  type HostConnectionHandle,
} from '../src/index.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

/** Structural webServer fake recording both route registries. */
function fakeHttpServer(
  routes: WebRoute[],
  upgrades: WebUpgradeRoute[],
): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port' | 'host' | 'protocol'> {
  return {
    host: '127.0.0.1',
    protocol: 'http:',
    register(route) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}

/** Bodyless GET carrying the given headers (enough for the fence and admission). */
function fakeRequest(headers: Record<string, string>, url = '/api/session.list'): IncomingMessage {
  const request = Readable.from([]) as IncomingMessage
  Object.assign(request, { url, method: 'GET', headers })
  return request
}

/** JSON POST carrying a complete client-request envelope. */
function fakePost(headers: Record<string, string>, url: string, body: unknown): IncomingMessage {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  Object.assign(request, { url, method: 'POST', headers: { 'content-type': 'application/json', ...headers } })
  return request
}

/** Response recorder compatible with the fence's short-circuit and the bridge. */
function fakeResponse(): {
  response: ServerResponse
  state: { status?: number; headers?: Record<string, string>; body?: string }
} {
  const state: { status?: number; headers?: Record<string, string>; body?: string } = {}
  const chunks: Buffer[] = []
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(value: number, headers?: Record<string, string>) {
      state.status = value
      if (headers !== undefined) state.headers = headers
      return this
    },
    write(value: string | Uint8Array) { chunks.push(Buffer.from(value)); return true },
    end(this: { writableEnded: boolean }, value?: unknown) {
      if (typeof value === 'string' || value instanceof Uint8Array) chunks.push(Buffer.from(value))
      if (chunks.length > 0) state.body = Buffer.concat(chunks).toString()
      this.writableEnded = true
      return this
    },
  }) as unknown as ServerResponse
  return { response, state }
}

async function mounted(config?: ConnectionConfig): Promise<{
  routes: WebRoute[]
  connection: HostConnectionHandle
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const routes: WebRoute[] = []
  const upgrades: WebUpgradeRoute[] = []
  provideBrowserCredentials(ctx)
  ctx.provide('webServer', fakeHttpServer(routes, upgrades) as WebServer)
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return {
    routes,
    connection: ctx.get('connection') as HostConnectionHandle,
    dispose: () => fiber.dispose(),
  }
}

/** Exchange a service's process token for one authority-bound Cookie header. */
function browserCookie(connection: HostConnectionHandle, authority: string): string {
  const url = new URL(connection.authenticatedUrl(`http://${authority}`))
  const exchanged = fakeResponse()
  connection.authorizeIndex(
    fakeRequest({ host: authority }, `${url.pathname}${url.search}`),
    exchanged.response,
  )
  const setCookie = exchanged.state.headers?.['set-cookie']
  if (setCookie === undefined) throw new Error('browser token exchange did not set a cookie')
  return setCookie.split(';', 1)[0]!
}

function headerOf(headers: ConnectionTrustRequest['headers'], name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Bearer-token authenticator double: each token maps to exactly one principal key. */
function bearerAuthenticator(tokens: ReadonlyMap<string, string>): ConnectionAuthenticator {
  return {
    name: 'test-bearer',
    identify(request) {
      const value = headerOf(request.headers, 'authorization')
      if (value === undefined || !value.startsWith('Bearer ')) return undefined
      const id = tokens.get(value.slice('Bearer '.length))
      return id === undefined ? undefined : { id }
    },
  }
}

describe('connection second-credential admission', () => {
  it('admits a bearer request as its own principal Peer and keeps the browser cookie on the operator', async () => {
    const { connection, dispose } = await mounted()
    try {
      connection.authenticators.register(bearerAuthenticator(new Map([['alpha', 'user:1'], ['beta', 'user:2']])))

      expect(connection.admit(fakeRequest({ host: 'localhost' }))).toEqual({ rejection: 401 })

      const alpha = connection.admit(fakeRequest({ host: 'localhost', authorization: 'Bearer alpha' }))
      const alphaAgain = connection.admit(fakeRequest({ host: 'localhost', authorization: 'Bearer alpha' }))
      const beta = connection.admit(fakeRequest({ host: 'localhost', authorization: 'Bearer beta' }))
      if (!('peer' in alpha) || !('peer' in alphaAgain) || !('peer' in beta)) {
        throw new Error(`expected principal admissions, got ${JSON.stringify([alpha, alphaAgain, beta])}`)
      }
      expect(alpha.peer.id).toBe(alphaAgain.peer.id)
      expect(beta.peer.id).not.toBe(alpha.peer.id)
      expect(alpha.peer).not.toBe(connection.operator)
      expect(connection.principalOf(alpha.peer)).toEqual({ id: 'user:1' })
      expect(connection.principalOf(connection.operator)).toBeUndefined()

      const browser = connection.admit(fakeRequest({
        host: 'localhost',
        cookie: browserCookie(connection, 'localhost'),
      }))
      if (!('peer' in browser)) throw new Error('the browser cookie must be admitted')
      expect(browser.peer).toBe(connection.operator)
    } finally {
      await dispose()
    }
  })

  it('hands the admitted principal Peer to the shared-channel handler', async () => {
    const { routes, connection, dispose } = await mounted()
    try {
      connection.authenticators.register(bearerAuthenticator(new Map([['alpha', 'user:1']])))
      const identity = { id: 'unset' }
      connection.rpc.intercept('/api', endpoint => endpoint === 'probe/echo', async (_endpoint, _payload, _signal, peer) => {
        identity.id = peer.id
        return { ok: true, value: { principal: connection.principalOf(peer)?.id ?? null } }
      })
      const route = routes.find(candidate => candidate.path === '/api')
      if (route === undefined) throw new Error('the /api route is not mounted')

      const response = fakeResponse()
      await route.handler(
        fakePost({ host: 'localhost', authorization: 'Bearer alpha' }, '/api/probe/echo', {
          type: 'client-request',
          rpcId: 'probe-1',
          method: 'probe/echo',
          payload: {},
        }),
        response.response,
      )
      const admitted = connection.admit(fakeRequest({ host: 'localhost', authorization: 'Bearer alpha' }))
      if (!('peer' in admitted)) throw new Error('the bearer request must be admitted')
      expect(identity.id).toBe(admitted.peer.id)
      expect(response.state.body).toContain('"principal":"user:1"')
    } finally {
      await dispose()
    }
  })
})
