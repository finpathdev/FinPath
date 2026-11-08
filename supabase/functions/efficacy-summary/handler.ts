// Public aggregate and the two writes for the opt-in study.
// verify_jwt is off so a signed-out visitor can read the aggregate. This
// handler still requires a user JWT before it stores a new event, and it
// never puts a user id or an individual row in the response.
// Deployed with verify_jwt = false. See supabase/config.toml.

import {
  K_MIN,
  parseRecord,
  parseWithdraw,
  summarizeEfficacy,
  toDbRow,
  tokenHash,
  type EfficacyEvent,
  type RecordEvent,
} from './summary.ts'

const MAX_EVENTS = 40
const PAGE = 1000
const CAP = 50000

export interface EfficacyAdmin {
  listEvents(): Promise<EfficacyEvent[]>
  countStudy(studyId: string): Promise<number>
  insertEvents(rows: ReturnType<typeof toDbRow>[]): Promise<{ error?: string }>
  deleteStudy(studyId: string, tokenHash: string): Promise<number>
  userIdFromJwt(jwt: string): Promise<string | null>
}

export function isAllowedStudyOrigin(origin: string | null): boolean {
  if(!origin) return false
  if(origin === 'https://finpathdev.github.io') return true
  try{
    const url = new URL(origin)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return local && (url.protocol === 'http:' || url.protocol === 'https:')
  }catch{
    return false
  }
}

export function studyCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  }
  if(isAllowedStudyOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin as string
  return headers
}

function json(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, studyCorsHeaders(origin)),
  })
}

function bearer(req: Request): string {
  const header = req.headers.get('Authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

export async function handleEfficacy(req: Request, deps: { admin: EfficacyAdmin }): Promise<Response> {
  const origin = req.headers.get('Origin')
  if(!isAllowedStudyOrigin(origin)) return json(origin, 403, { error: 'origin' })
  if(req.method === 'OPTIONS') return new Response(null, { status: 204, headers: studyCorsHeaders(origin) })

  try{
    if(req.method === 'GET'){
      const events = await deps.admin.listEvents()
      const summary = summarizeEfficacy(events, K_MIN)
      return json(origin, 200, summary)
    }
    if(req.method !== 'POST') return json(origin, 405, { error: 'method' })
    let body: unknown
    try{
      body = await req.json()
    }catch{
      return json(origin, 400, { error: 'bad_request' })
    }
    const action = body && typeof body === 'object' ? (body as { action?: string }).action : ''
    if(action === 'withdraw'){
      const parsed = parseWithdraw(body)
      if(!parsed.ok) return json(origin, parsed.status, { error: parsed.error })
      const hash = await tokenHash(parsed.token)
      const deleted = await deps.admin.deleteStudy(parsed.studyId, hash)
      return json(origin, 200, { ok: true, deleted })
    }
    if(action !== 'record') return json(origin, 400, { error: 'bad_request' })
    const parsed = parseRecord(body)
    if(!parsed.ok) return json(origin, parsed.status, { error: parsed.error })
    const userId = await deps.admin.userIdFromJwt(bearer(req))
    if(!userId) return json(origin, 401, { error: 'sign_in' })
    const hash = await tokenHash(parsed.token)
    const existing = await deps.admin.countStudy(parsed.studyId)
    if(existing + parsed.events.length > MAX_EVENTS) return json(origin, 429, { error: 'cap' })
    const rows = parsed.events.map((event: RecordEvent) => toDbRow(parsed.studyId, hash, event))
    const wrote = await deps.admin.insertEvents(rows)
    if(wrote.error) return json(origin, 400, { error: 'not_saved' })
    return json(origin, 200, { ok: true, accepted: rows.map((row) => row.event_id) })
  }catch{
    return json(origin, 500, { error: 'unavailable' })
  }
}

export function mapEvent(row: Record<string, unknown>): EfficacyEvent {
  return {
    studyId: String(row.study_id || ''),
    kind: String(row.kind || ''),
    score: row.score == null ? null : Number(row.score),
    lessonPoints: row.lesson_points == null ? null : Number(row.lesson_points),
    quizPoints: row.quiz_points == null ? null : Number(row.quiz_points),
    breadthPoints: row.breadth_points == null ? null : Number(row.breadth_points),
    action: row.action == null ? null : String(row.action),
    ageBand: row.age_band == null ? null : String(row.age_band),
    createdAt: row.created_at == null ? null : String(row.created_at),
  }
}

export async function listAllEvents(query: (from: number, to: number) => Promise<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>): Promise<EfficacyEvent[]> {
  const all: EfficacyEvent[] = []
  let from = 0
  while(all.length < CAP){
    const { data, error } = await query(from, from + PAGE - 1)
    if(error) throw new Error('read failed')
    const rows = data || []
    rows.forEach((row) => all.push(mapEvent(row)))
    if(rows.length < PAGE) break
    from += PAGE
  }
  return all
}
