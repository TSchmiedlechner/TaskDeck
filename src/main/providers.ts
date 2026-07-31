import { spawn } from 'node:child_process'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { BrainProviderId } from '@shared/types'

export interface StructuredRequest<T> {
  model: string
  system: string
  user: string
  maxTokens: number
  schema: z.ZodType<T>
}

export interface StructuredResponse<T> {
  parsed: T | null
  inputTokens: number
  outputTokens: number
}

export interface CompletionProvider {
  readonly id: BrainProviderId
  complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]+$/

/** Direct Anthropic API with schema-enforced structured outputs. */
export class ApiProvider implements CompletionProvider {
  readonly id = 'api' as const
  private client: Anthropic | null = null
  private clientKey: string | null = null

  constructor(private getKey: () => string | null) {}

  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const key = this.getKey()
    if (!key) throw new Error('No API key configured')
    if (this.clientKey !== key || !this.client) {
      this.client = new Anthropic({ apiKey: key })
      this.clientKey = key
    }
    const response = await this.client.messages.parse({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: { format: zodOutputFormat(req.schema) }
    })
    return {
      parsed: (response.parsed_output ?? null) as T | null,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens
    }
  }
}

/**
 * Claude Code CLI in headless print mode (`claude -p --output-format json`).
 * Authenticates via the user's Claude subscription (Max plan) — no API key,
 * no per-token billing. Schema is prompt-enforced and Zod-validated, with one retry.
 */
export class CliProvider implements CompletionProvider {
  readonly id = 'cli' as const
  available = false

  async complete<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    if (!this.available) throw new Error('Claude CLI not available')
    const schemaJson = JSON.stringify(z.toJSONSchema(req.schema))
    const basePrompt =
      `${req.system}\n\n${req.user}\n\n` +
      `Respond with ONLY a single JSON object — no markdown fences, no commentary. ` +
      `It must validate against this JSON Schema:\n${schemaJson}`

    const first = await runCli(req.model, basePrompt)
    let inputTokens = first.inputTokens
    let outputTokens = first.outputTokens
    let parsed = tryParseJson(req.schema, first.text)
    if (parsed.ok) return { parsed: parsed.value, inputTokens, outputTokens }

    const retry = await runCli(
      req.model,
      basePrompt + `\n\nYour previous attempt was invalid (${parsed.error}). Return only the corrected JSON object.`
    )
    inputTokens += retry.inputTokens
    outputTokens += retry.outputTokens
    parsed = tryParseJson(req.schema, retry.text)
    if (parsed.ok) return { parsed: parsed.value, inputTokens, outputTokens }
    throw new Error(`CLI returned invalid JSON twice: ${parsed.error}`)
  }
}

/**
 * Spawn the Claude CLI. On Windows the npm shim is a .cmd, which requires a shell;
 * we pass one prebuilt command string (every part is validated/constant) to avoid
 * the deprecated shell+args-array combination.
 */
function spawnCli(args: string[], stdio: ('pipe' | 'ignore')[], env?: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
  const options = { windowsHide: true, env, stdio } as const
  if (process.platform === 'win32') {
    return spawn(['claude', ...args].join(' '), { ...options, shell: true })
  }
  return spawn('claude', args, options)
}

/** Quick availability probe: `claude --version` exits 0 within the timeout. */
export function detectCli(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean): void => {
      if (!settled) {
        settled = true
        resolve(ok)
      }
    }
    try {
      const child = spawnCli(['--version'], ['ignore', 'ignore', 'ignore'])
      const timer = setTimeout(() => {
        child.kill()
        done(false)
      }, 10_000)
      child.on('error', () => {
        clearTimeout(timer)
        done(false)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        done(code === 0)
      })
    } catch {
      done(false)
    }
  })
}

interface CliRunResult {
  text: string
  inputTokens: number
  outputTokens: number
}

function runCli(model: string, prompt: string): Promise<CliRunResult> {
  if (!MODEL_ID_PATTERN.test(model)) return Promise.reject(new Error(`Invalid model id: ${model}`))
  return new Promise((resolve, reject) => {
    // Strip API credentials so the CLI always authenticates via the subscription login.
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN

    const child = spawnCli(['-p', '--output-format', 'json', '--model', model], ['pipe', 'pipe', 'pipe'], env)

    let stdout = ''
    let stderr = ''
    let settled = false
    const fail = (err: Error): void => {
      if (!settled) {
        settled = true
        reject(err)
      }
    }

    const timer = setTimeout(() => {
      child.kill()
      fail(new Error('CLI call timed out after 120s'))
    }, 120_000)

    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      fail(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      if (code !== 0) {
        fail(new Error(`CLI exited ${code}: ${(stderr || stdout).slice(0, 300)}`))
        return
      }
      try {
        const envelope = JSON.parse(stdout) as {
          result?: string
          is_error?: boolean
          usage?: { input_tokens?: number; output_tokens?: number }
        }
        if (envelope.is_error) {
          fail(new Error(`CLI reported an error: ${String(envelope.result).slice(0, 300)}`))
          return
        }
        settled = true
        resolve({
          text: envelope.result ?? '',
          inputTokens: envelope.usage?.input_tokens ?? 0,
          outputTokens: envelope.usage?.output_tokens ?? 0
        })
      } catch {
        fail(new Error(`Could not parse CLI output envelope: ${stdout.slice(0, 300)}`))
      }
    })

    child.stdin?.write(prompt)
    child.stdin?.end()
  })
}

/** Pull the first JSON object out of possibly-noisy model text (fences, prose). */
export function extractFirstJson(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return trimmed.slice(start, end + 1)
}

function tryParseJson<T>(
  schema: z.ZodType<T>,
  text: string
): { ok: true; value: T } | { ok: false; error: string } {
  const jsonText = extractFirstJson(text)
  if (!jsonText) return { ok: false, error: 'no JSON object found in output' }
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch (err) {
    return { ok: false, error: `JSON parse error: ${(err as Error).message}` }
  }
  const result = schema.safeParse(data)
  if (result.success) return { ok: true, value: result.data }
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
}
