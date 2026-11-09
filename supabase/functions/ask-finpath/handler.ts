// HTTP handler for Ask FinPath. Auth and xAI are injected so tests
// can run without a live project or an API key.

import {
  BURST_PER_MINUTE,
  DAILY_LIMIT,
  DEFAULT_XAI_MODEL,
  XAI_URL,
  answerGivesAdvice,
  buildMessages,
  classifyQuestion,
  corsHeaders,
  refusalAnswer,
  sanitizeHistory,
  sanitizeLessonContext,
  sanitizeQuestion,
  scrubSecrets,
  xaiBody,
} from './policy.ts'

export interface AskAdmin {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: { active?: boolean | null } | null; error: { message?: string } | null }>
      }
    }
  }
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }>
}

export interface AskDeps {
  authorize(req: Request): Promise<{ userId: string; admin: AskAdmin } | null>
  fetchImpl: typeof fetch
  env(name: string): string | undefined
}

const MAX_BODY = 12000

function json(req: Request, status: number, body: Record<string, unknown>, secrets: string[]): Response {
  const safe = JSON.parse(scrubSecrets(JSON.stringify(body), secrets)) as Record<string, unknown>
  const headers = new Headers(corsHeaders(req.headers.get('Origin')))
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(JSON.stringify(safe), { status, headers })
}

function asQuota(data: unknown): { allowed: boolean; reason: string | null; remaining: number; limit: number } | null {
  const row = typeof data === 'string' ? safeParse(data) : data
  if (!row || typeof row !== 'object') return null
  const rec = row as Record<string, unknown>
  if (typeof rec.allowed !== 'boolean') return null
  const remaining = typeof rec.remaining === 'number' && Number.isFinite(rec.remaining) ? Math.max(0, Math.floor(rec.remaining)) : 0
  const limit = typeof rec.limit === 'number' && Number.isFinite(rec.limit) ? Math.floor(rec.limit) : 0
  const reason = typeof rec.reason === 'string' ? rec.reason : null
  return { allowed: rec.allowed, reason, remaining, limit }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function answerText(payload: unknown): { text: string; modelRefused: boolean } | null {
  if (!payload || typeof payload !== 'object') return null
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return null
  const message = (choices[0] as { message?: unknown }).message
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  const refusal = (message as { refusal?: unknown }).refusal
  const modelRefused = typeof refusal === 'string' && refusal.trim().length > 0
  const text = typeof content === 'string' ? content.trim() : ''
  return { text, modelRefused }
}

export async function handleAsk(req: Request, deps: AskDeps): Promise<Response> {
  const secrets: string[] = []
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('Origin')) })
    }
    if (req.method !== 'POST') {
      return json(req, 405, { error: 'Use POST.' }, secrets)
    }

    const auth = await deps.authorize(req)
    if (!auth) return json(req, 401, { error: 'Sign in required.' }, secrets)

    const raw = await req.text()
    if (raw.length > MAX_BODY) return json(req, 400, { error: 'That request is too large.' }, secrets)
    const body = safeParse(raw)
    if (!body || typeof body !== 'object') return json(req, 400, { error: 'Send a JSON question.' }, secrets)
    const rec = body as Record<string, unknown>

    const question = sanitizeQuestion(rec.q)
    if ('error' in question) return json(req, 400, { error: question.error }, secrets)
    const history = sanitizeHistory(rec.history)
    const lesson = sanitizeLessonContext(rec.lessonContext)

    const plan = 'free'
    const limit = DAILY_LIMIT

    const consumed = await auth.admin.rpc('consume_ask_quota', {
      p_user_id: auth.userId,
      p_daily_limit: limit,
      p_burst_limit: BURST_PER_MINUTE,
    })
    if (consumed.error) return json(req, 503, { error: 'Ask FinPath is unavailable right now.' }, secrets)
    const quota = asQuota(consumed.data)
    if (!quota) return json(req, 503, { error: 'Ask FinPath is unavailable right now.' }, secrets)
    if (!quota.allowed) {
      const burst = quota.reason === 'burst'
      return json(req, 429, {
        error: burst
          ? 'Too many questions. Wait a minute and try again.'
          : 'Daily limit reached.',
        remaining: quota.remaining,
        limit,
        plan,
        reason: burst ? 'burst' : 'daily',
      }, secrets)
    }

    const refusal = classifyQuestion(question.q, lesson)
    if (refusal) {
      return json(req, 200, {
        answer: refusal.answer,
        remaining: quota.remaining,
        refused: true,
        plan,
      }, secrets)
    }

    const apiKey = deps.env('XAI_API_KEY') || ''
    if (apiKey) secrets.push(apiKey)
    const model = (deps.env('XAI_MODEL') || DEFAULT_XAI_MODEL).trim()
    if (!apiKey || !/^[\w.-]{1,64}$/.test(model)) {
      await refund(auth.admin, auth.userId, limit)
      return json(req, 503, { error: 'Ask FinPath is unavailable right now.', refunded: true }, secrets)
    }

    let upstream: Response
    try {
      upstream = await deps.fetchImpl(XAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(xaiBody(model, buildMessages(question.q, history, lesson))),
        signal: AbortSignal.timeout(25000),
      })
    } catch (err) {
      console.error('ask-finpath upstream error', scrubSecrets(err instanceof Error ? err.message : 'fetch failed', secrets))
      const remaining = await refund(auth.admin, auth.userId, limit)
      return json(req, 502, {
        error: 'Ask FinPath is unavailable right now.',
        refunded: remaining !== null,
        remaining: remaining ?? quota.remaining,
      }, secrets)
    }

    const upstreamText = await upstream.text()
    if (!upstream.ok) {
      console.error('ask-finpath upstream status', upstream.status)
      const remaining = await refund(auth.admin, auth.userId, limit)
      return json(req, 502, {
        error: 'Ask FinPath is unavailable right now.',
        refunded: remaining !== null,
        remaining: remaining ?? quota.remaining,
      }, secrets)
    }

    const parsed = answerText(safeParse(upstreamText))
    if (!parsed) {
      const remaining = await refund(auth.admin, auth.userId, limit)
      return json(req, 502, {
        error: 'Ask FinPath is unavailable right now.',
        refunded: remaining !== null,
        remaining: remaining ?? quota.remaining,
      }, secrets)
    }
    if (parsed.modelRefused || answerGivesAdvice(parsed.text)) {
      return json(req, 200, {
        answer: refusalAnswer('model'),
        remaining: quota.remaining,
        refused: true,
        plan,
      }, secrets)
    }
    if (!parsed.text) {
      const remaining = await refund(auth.admin, auth.userId, limit)
      return json(req, 502, {
        error: 'Ask FinPath is unavailable right now.',
        refunded: remaining !== null,
        remaining: remaining ?? quota.remaining,
      }, secrets)
    }

    const answer = scrubSecrets(parsed.text.slice(0, 2500), secrets)
    return json(req, 200, { answer, remaining: quota.remaining, refused: false, plan }, secrets)
  } catch (err) {
    console.error('ask-finpath failed', scrubSecrets(err instanceof Error ? err.message : 'handler failed', secrets))
    return json(req, 500, { error: 'Ask FinPath is unavailable right now.' }, secrets)
  }
}

async function refund(admin: AskAdmin, userId: string, limit: number): Promise<number | null> {
  try {
    const released = await admin.rpc('release_ask_quota', {
      p_user_id: userId,
      p_daily_limit: limit,
    })
    if (released.error) return null
    const row = asQuota({ ...(typeof released.data === 'object' && released.data ? released.data as object : {}), allowed: true })
    return row ? row.remaining : null
  } catch {
    return null
  }
}
