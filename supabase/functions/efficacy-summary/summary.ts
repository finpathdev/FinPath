// k-anonymous aggregate for the opt-in efficacy study.
// Groups smaller than k are omitted entirely, including their counts, so a
// published total cannot be subtracted down to one person.

export const K_MIN = 10

export interface EfficacyEvent {
  studyId: string
  kind: string
  score?: number | null
  lessonPoints?: number | null
  quizPoints?: number | null
  breadthPoints?: number | null
  action?: string | null
  ageBand?: string | null
  createdAt?: string | number | null
}

export interface EfficacySummary {
  enough: boolean
  k: number
  message: string
  participants?: number
  literacy?: {
    preMean: number | null
    postMean: number | null
    deltaMean: number | null
    preNote: string | null
    postNote: string | null
    deltaNote: string | null
  }
  progress?: { lessons: number; quizzes: number; learners: number } | null
  ageBands?: { band: string; participants: number }[] | null
}

const NOT_ENOUGH = 'Not enough participants yet'
const CELL = 'Not enough for this number yet'

function atMs(value: string | number | null | undefined): number {
  if(typeof value === 'number' && Number.isFinite(value)) return value
  const n = Date.parse(String(value || ''))
  return Number.isFinite(n) ? n : 0
}

function mean(nums: number[]): number | null {
  if(!nums.length) return null
  const sum = nums.reduce((acc, n) => acc + n, 0)
  return Math.round(sum / nums.length)
}

function pick(events: EfficacyEvent[], kind: string, which: 'earliest' | 'latest'): EfficacyEvent | null {
  const rows = events.filter((event) => event.kind === kind && event.score != null)
  if(!rows.length) return null
  return rows.slice().sort((a, b) => {
    const delta = atMs(a.createdAt) - atMs(b.createdAt)
    return which === 'earliest' ? delta : -delta
  })[0]
}

export function summarizeEfficacy(events: EfficacyEvent[] | null | undefined, k = K_MIN): EfficacySummary {
  const floor = Number.isFinite(k) && k >= 2 ? Math.floor(k) : K_MIN
  const byStudy = new Map<string, EfficacyEvent[]>()
  for(const event of events || []){
    if(!event || typeof event.studyId !== 'string' || !event.studyId) continue
    const list = byStudy.get(event.studyId) || []
    list.push(event)
    byStudy.set(event.studyId, list)
  }
  if(byStudy.size < floor){
    return { enough: false, k: floor, message: NOT_ENOUGH }
  }

  const preScores: number[] = []
  const postScores: number[] = []
  const deltas: number[] = []
  const bandCounts = new Map<string, number>()
  let progressLessons = 0
  let progressQuizzes = 0
  let progressLearners = 0

  for(const list of byStudy.values()){
    const pre = pick(list, 'literacy_pre', 'earliest')
    const post = pick(list, 'literacy_post', 'latest')
    if(pre && pre.score != null) preScores.push(pre.score)
    if(post && post.score != null) postScores.push(post.score)
    if(pre && post && pre.score != null && post.score != null) deltas.push(post.score - pre.score)
    const band = list.map((event) => event.ageBand).find((value) => typeof value === 'string' && value)
    if(band) bandCounts.set(band, (bandCounts.get(band) || 0) + 1)
    const progress = list.filter((event) => event.kind === 'progress')
    if(progress.length){
      progressLearners += 1
      progress.forEach((event) => {
        if(event.action === 'lesson_finished') progressLessons += 1
        if(event.action === 'quiz_finished') progressQuizzes += 1
      })
    }
  }

  const preOk = preScores.length >= floor
  const postOk = postScores.length >= floor
  const deltaOk = deltas.length >= floor
  const progressOk = progressLearners >= floor

  const bandEntries = Array.from(bandCounts.entries()).filter(([, n]) => n > 0)
  const bandUnsafe = bandEntries.some(([, n]) => n < floor)
  const published = bandEntries.reduce((sum, [, n]) => sum + n, 0)
  const skipped = byStudy.size - published
  const ageBands = !bandEntries.length || bandUnsafe || (skipped > 0 && skipped < floor)
    ? null
    : bandEntries
      .map(([band, participants]) => ({ band, participants }))
      .sort((a, b) => a.band < b.band ? -1 : a.band > b.band ? 1 : 0)

  return {
    enough: true,
    k: floor,
    message: 'Aggregated across people who joined. Groups smaller than ' + floor + ' are left out.',
    participants: byStudy.size,
    literacy: {
      preMean: preOk ? mean(preScores) : null,
      postMean: postOk ? mean(postScores) : null,
      deltaMean: deltaOk ? mean(deltas) : null,
      preNote: preOk ? null : CELL,
      postNote: postOk ? null : CELL,
      deltaNote: deltaOk ? null : CELL,
    },
    progress: progressOk ? { lessons: progressLessons, quizzes: progressQuizzes, learners: progressLearners } : null,
    ageBands,
  }
}

const EVENT_KEYS = new Set(['eventId', 'kind', 'score', 'lessonPoints', 'quizPoints', 'breadthPoints', 'action', 'ageBand'])
const BODY_KEYS: Record<string, Set<string>> = {
  record: new Set(['action', 'studyId', 'token', 'ageConfirmed', 'ageBand', 'events']),
  withdraw: new Set(['action', 'studyId', 'token']),
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EVENT_ID = /^[a-z0-9:_-]{1,80}$/
const BANDS = new Set(['13-15', '16-17', '18-24', '25+'])
const FORBIDDEN = ['email', 'name', 'school', 'location', 'age', 'userid', 'user_id', 'latitude', 'longitude', 'ip', 'address']

export interface RecordEvent {
  eventId: string
  kind: 'literacy_pre' | 'literacy_post' | 'progress'
  score: number | null
  lessonPoints: number | null
  quizPoints: number | null
  breadthPoints: number | null
  action: 'lesson_finished' | 'quiz_finished' | null
  ageBand: string | null
}

export type RecordDecision =
  | { ok: true; studyId: string; token: string; events: RecordEvent[] }
  | { ok: false; status: number; error: string }

function forbiddenKey(key: string): boolean {
  const name = key.toLowerCase().replace(/[^a-z0-9_]/g, '')
  return FORBIDDEN.indexOf(name) >= 0
}

function inRange(value: unknown, lo: number, hi: number): number | null {
  if(value == null) return null
  if(typeof value !== 'number' || !Number.isFinite(value)) return Number.NaN
  const n = Math.round(value)
  if(n < lo || n > hi) return Number.NaN
  return n
}

export function parseRecord(body: unknown): RecordDecision {
  if(!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'bad_request' }
  const src = body as Record<string, unknown>
  if(Object.keys(src).some(forbiddenKey)) return { ok: false, status: 400, error: 'bad_request' }
  for(const key of Object.keys(src)){
    if(!BODY_KEYS.record.has(key)) return { ok: false, status: 400, error: 'bad_request' }
  }
  if(src.ageConfirmed !== '13plus') return { ok: false, status: 403, error: 'age_blocked' }
  const studyId = String(src.studyId || '')
  const token = String(src.token || '')
  if(!UUID.test(studyId) || token.length < 32 || token.length > 120) return { ok: false, status: 400, error: 'bad_request' }
  if(src.ageBand != null && !BANDS.has(String(src.ageBand))) return { ok: false, status: 400, error: 'bad_request' }
  const ageBand = src.ageBand == null ? null : String(src.ageBand)
  if(!Array.isArray(src.events) || !src.events.length || src.events.length > 20) return { ok: false, status: 400, error: 'bad_request' }
  const events: RecordEvent[] = []
  for(const item of src.events){
    if(!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, status: 400, error: 'bad_request' }
    const row = item as Record<string, unknown>
    if(Object.keys(row).some((key) => forbiddenKey(key) || !EVENT_KEYS.has(key))) return { ok: false, status: 400, error: 'bad_request' }
    const eventId = String(row.eventId || '')
    if(!EVENT_ID.test(eventId)) return { ok: false, status: 400, error: 'bad_request' }
    if(typeof row.kind !== 'string') return { ok: false, status: 400, error: 'bad_request' }
    const band = row.ageBand == null ? ageBand : String(row.ageBand)
    if(row.ageBand != null && !BANDS.has(String(row.ageBand))) return { ok: false, status: 400, error: 'bad_request' }
    if(row.kind === 'progress'){
      if(row.action !== 'lesson_finished' && row.action !== 'quiz_finished') return { ok: false, status: 400, error: 'bad_request' }
      if(row.score != null || row.lessonPoints != null || row.quizPoints != null || row.breadthPoints != null){
        return { ok: false, status: 400, error: 'bad_request' }
      }
      events.push({
        eventId,
        kind: 'progress',
        score: null,
        lessonPoints: null,
        quizPoints: null,
        breadthPoints: null,
        action: row.action,
        ageBand: band,
      })
      continue
    }
    if(row.kind !== 'literacy_pre' && row.kind !== 'literacy_post') return { ok: false, status: 400, error: 'bad_request' }
    const score = inRange(row.score, 0, 1000)
    const lessonPoints = inRange(row.lessonPoints, 0, 400)
    const quizPoints = inRange(row.quizPoints, 0, 400)
    const breadthPoints = inRange(row.breadthPoints, 0, 200)
    if(score == null || Number.isNaN(score) || Number.isNaN(lessonPoints) || Number.isNaN(quizPoints) || Number.isNaN(breadthPoints)){
      return { ok: false, status: 400, error: 'bad_request' }
    }
    if(row.action != null) return { ok: false, status: 400, error: 'bad_request' }
    events.push({
      eventId,
      kind: row.kind,
      score,
      lessonPoints,
      quizPoints,
      breadthPoints,
      action: null,
      ageBand: band,
    })
  }
  return { ok: true, studyId, token, events }
}

export function parseWithdraw(body: unknown): { ok: true; studyId: string; token: string } | { ok: false; status: number; error: string } {
  if(!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'bad_request' }
  const src = body as Record<string, unknown>
  if(Object.keys(src).some((key) => forbiddenKey(key) || !BODY_KEYS.withdraw.has(key))) return { ok: false, status: 400, error: 'bad_request' }
  const studyId = String(src.studyId || '')
  const token = String(src.token || '')
  if(!UUID.test(studyId) || token.length < 32 || token.length > 120) return { ok: false, status: 400, error: 'bad_request' }
  return { ok: true, studyId, token }
}

export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function toDbRow(studyId: string, hash: string, event: RecordEvent) {
  return {
    study_id: studyId,
    event_id: event.eventId,
    token_hash: hash,
    kind: event.kind,
    score: event.score,
    lesson_points: event.lessonPoints,
    quiz_points: event.quizPoints,
    breadth_points: event.breadthPoints,
    action: event.action,
    age_band: event.ageBand,
  }
}
