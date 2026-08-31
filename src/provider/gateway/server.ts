/**
 * Built-in Anthropic-compatible gateway.
 *
 * Listens on `127.0.0.1:<port>` and exposes `POST /v1/messages` in the Anthropic
 * Messages API format. Translates the request to OpenAI chat/completions,
 * forwards to OpenAI (using the provider instance's key + endpoint), and streams
 * the OpenAI response back as Anthropic SSE — so the base Claude Code pipeline
 * needs zero changes. This replaces the need for an external `ccr` process.
 */
import { createServer, type Server } from 'node:http'
import { parseModelRef } from '../types.js'
import {
  AnthropicStreamEncoder,
  anthropicRequestToOpenAI,
  buildAnthropicModelsResponse,
  sseEvent,
  type OpenAIModelEntry,
} from './transform.js'

const DEFAULT_PORT = 3456

export interface GatewayConfig {
  apiKey: string
  apiUrl: string // OpenAI base, e.g. https://api.openai.com/v1
  port?: number
}

function openaiBase(cfg: GatewayConfig): string {
  return cfg.apiUrl.endsWith('/') ? cfg.apiUrl.slice(0, -1) : cfg.apiUrl
}

function openaiEndpoint(cfg: GatewayConfig): string {
  return `${openaiBase(cfg)}/chat/completions`
}

function openaiModelsEndpoint(cfg: GatewayConfig): string {
  return `${openaiBase(cfg)}/models`
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function jsonError(res: import('node:http').ServerResponse, code: number, message: string): void {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }))
}

export function startGateway(config: GatewayConfig): Server {
  const port = config.port ?? DEFAULT_PORT
  const server = createServer(async (req, res) => {
    // Fetch models: translate the upstream catalog to the Anthropic list shape.
    // No allowlisting — the full upstream model list is passed through.
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      await handleListModels(res, config, req.url)
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      res.writeHead(404)
      res.end()
      return
    }
    let bodyText: string
    try {
      bodyText = await readBody(req)
    } catch {
      return jsonError(res, 400, 'bad request')
    }

    let anthropicReq: Record<string, any>
    try {
      anthropicReq = JSON.parse(bodyText)
    } catch {
      return jsonError(res, 400, 'invalid JSON')
    }

    const openaiBody = anthropicRequestToOpenAI(anthropicReq)
    let upstream: Response
    try {
      upstream = await fetch(openaiEndpoint(config), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(openaiBody),
      })
    } catch (error) {
      return jsonError(res, 502, `upstream request failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => '')
      return jsonError(res, upstream.status, `upstream error: ${t.slice(0, 500)}`)
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    const encoder = new AnthropicStreamEncoder(
      (type, data) => res.write(sseEvent(type, data)),
      stripRef(anthropicReq.model),
      `msg_${Date.now().toString(36)}`,
      undefined,
    )

    // Parse OpenAI SSE stream and feed the encoder. Globals added by Node 20.
    const reader = upstream.body?.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // SSE lines are `data: {...}` terminated by blank line.
          let idx: number
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            for (const line of block.split('\n')) {
              const trimmed = line.trim()
              if (trimmed.startsWith('data:')) {
                const payload = trimmed.slice(5).trim()
                if (payload === '[DONE]') continue
                try {
                  encoder.feed(JSON.parse(payload))
                } catch {
                  /* skip malformed chunk */
                }
              }
            }
          }
        }
      }
    } catch {
      /* client may disconnect; still finish cleanly */
    }

    try {
      encoder.finish()
      res.end()
    } catch {
      /* ignore write errors after close */
    }
  })

  server.listen(port, '127.0.0.1')
  return server
}

function stripRef(model: string): string {
  return parseModelRef(model)?.modelId ?? model
}

export function stopGateway(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}

/**
 * Serve `GET /v1/models` (Anthropic list shape) from the upstream
 * OpenAI-compatible `/models` catalog. Everything upstream reports is returned —
 * there is deliberately no filter to a fixed claude-* subset, so the model list
 * is the provider's full, unlimited catalog.
 */
async function handleListModels(
  res: import('node:http').ServerResponse,
  cfg: GatewayConfig,
  rawUrl: string,
): Promise<void> {
  const upstream = await fetchUpstreamModels(cfg)
  if (upstream === null) {
    jsonError(res, 502, 'upstream model fetch failed')
    return
  }
  const url = new URL(rawUrl, 'http://localhost')
  const params = {
    limit: parseInt(url.searchParams.get('limit') ?? '', 10) || undefined,
    afterId: url.searchParams.get('after_id'),
    beforeId: url.searchParams.get('before_id'),
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(buildAnthropicModelsResponse(upstream, params)))
}

async function fetchUpstreamModels(
  cfg: GatewayConfig,
): Promise<OpenAIModelEntry[] | null> {
  try {
    const resp = await fetch(openaiModelsEndpoint(cfg), {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
    })
    if (!resp.ok) return null
    const body = (await resp.json()) as {
      data?: Array<{ id?: unknown; created?: number }>
    }
    if (!Array.isArray(body.data)) return null
    const out: OpenAIModelEntry[] = []
    for (const m of body.data) {
      if (m && typeof m.id === 'string') {
        out.push({
          id: m.id,
          created: typeof m.created === 'number' ? m.created : undefined,
        })
      }
    }
    return out
  } catch {
    return null
  }
}
