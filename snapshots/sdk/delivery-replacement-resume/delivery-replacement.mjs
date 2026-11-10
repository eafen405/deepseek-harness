/** Exercise delivery-first history and its replacement across cold SDK resumes. */
export const inject = ['agents']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Scenario-owned runtime. */
export function apply(ctx) {
  ctx.on('agent/created', async ({ agent, source }) => {
    if (source !== 'startup') return
    agent.session.append('delivery/message', {
      deliveryId: 'early-delivery', origin: { sessionId: 'sender-session' },
      message: {
        role: 'assistant', id: 'early-delivery-message',
        content: [{ type: 'text', text: 'Delivery before the first human input.' }],
        source: { kind: 'delivered-message', deliveryId: 'early-delivery', senderSessionId: 'sender-session' },
      },
    }, { surfaceOp: 'append' })
  })
  ctx.on('llm/stream', (request, next) => {
    const text = JSON.stringify(request.messages)
    const replaced = text.includes('Earlier delivery cleared.')
    if (text.includes('Delivery before the first human input.') === replaced) {
      throw new Error('Assembled request must contain the delivery until its replacement, then only the checkpoint')
    }
    if (!request.messages.some(message => message.role === 'system')) {
      throw new Error('Cold restoration must retain the system prompt after the early delivery')
    }
    return next()
  })
  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    if (turn !== 2) return
    const delivery = agent.session.surface.nodes.find(seq => agent.session.eventAt(seq)?.type === 'delivery/message')
    if (delivery === undefined) throw new Error('Expected the early delivery before replacement')
    agent.session.append('user/message', {
      role: 'user', id: 'replacement-message',
      content: [{ type: 'text', text: 'Earlier delivery cleared.' }],
      source: { kind: 'user' },
    }, {
      surfaceOp: { op: 'replace', startSeq: delivery, endSeq: delivery },
      sourceEventSeqs: [delivery],
    })
  })
}
