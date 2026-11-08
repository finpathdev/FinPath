import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleEfficacy, type EfficacyAdmin } from './handler.ts'
import { toDbRow, tokenHash, type RecordEvent } from './summary.ts'

const ORIGIN = 'https://finpathdev.github.io'
const STUDY = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const TOKEN = 'token-token-token-token-token-token'

function admin(partial: Partial<EfficacyAdmin> & { rows?: Record<string, unknown>[] }): EfficacyAdmin & { rows: Record<string, unknown>[] } {
  const rows = partial.rows || []
  return {
    rows,
    async listEvents(){
      return rows.map((row) => ({
        studyId: String(row.study_id),
        kind: String(row.kind),
        score: row.score == null ? null : Number(row.score),
        action: row.action == null ? null : String(row.action),
        ageBand: row.age_band == null ? null : String(row.age_band),
        createdAt: '2026-11-08T00:00:00Z',
      }))
    },
    async countStudy(studyId){
      return rows.filter((row) => row.study_id === studyId).length
    },
    async insertEvents(next){
      next.forEach((row) => rows.push(row as Record<string, unknown>))
      return {}
    },
    async deleteStudy(studyId, hash){
      const before = rows.length
      for(let i = rows.length - 1; i >= 0; i--){
        if(rows[i].study_id === studyId && rows[i].token_hash === hash) rows.splice(i, 1)
      }
      return before - rows.length
    },
    async userIdFromJwt(jwt){
      return jwt === 'good-user' ? '11111111-1111-4111-8111-111111111111' : null
    },
    ...partial,
  }
}

function call(method: string, body: unknown, auth?: string, origin = ORIGIN){
  const headers = new Headers({ Origin: origin })
  if(auth) headers.set('Authorization', 'Bearer ' + auth)
  const req = new Request('https://ivhhfhemcecwqadrjmwq.supabase.co/functions/v1/efficacy-summary', {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  })
  return req
}

test('the aggregate response hides individual rows below k', async function(){
  const book = admin({})
  for(let i = 0; i < 9; i++){
    book.rows.push({ study_id: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(i).padStart(12, '0'), kind: 'literacy_pre', score: 15 })
  }
  const res = await handleEfficacy(call('GET', null), { admin: book })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.enough, false)
  assert.equal(body.message, 'Not enough participants yet')
  assert.equal(JSON.stringify(body).includes('aaaaaaaa-aaaa'), false)
  assert.equal(body.participants, undefined)
})

test('a record requires a signed-in user and a 13+ attestation, and stores no user id', async function(){
  const book = admin({})
  const event: RecordEvent = { eventId: 'literacy_pre', kind: 'literacy_pre', score: 22, lessonPoints: 10, quizPoints: 0, breadthPoints: 0, action: null, ageBand: '16-17' }
  const payload = { action: 'record', studyId: STUDY, token: TOKEN, ageConfirmed: '13plus', ageBand: '16-17', events: [event] }
  const signedOut = await handleEfficacy(call('POST', payload), { admin: book })
  assert.equal(signedOut.status, 401)
  assert.equal(book.rows.length, 0)
  const under = await handleEfficacy(call('POST', Object.assign({}, payload, { ageConfirmed: 'under13' }), 'good-user'), { admin: book })
  assert.equal(under.status, 403)
  assert.equal(book.rows.length, 0)
  const saved = await handleEfficacy(call('POST', payload, 'good-user'), { admin: book })
  const savedBody = await saved.json()
  assert.equal(saved.status, 200)
  assert.equal(savedBody.ok, true)
  assert.equal(book.rows.length, 1)
  assert.equal(book.rows[0].user_id, undefined)
  assert.equal(book.rows[0].token_hash, await tokenHash(TOKEN))
  assert.equal(JSON.stringify(book.rows[0]).includes(TOKEN), false)
  const expected = toDbRow(STUDY, await tokenHash(TOKEN), event)
  assert.equal(book.rows[0].study_id, expected.study_id)
  assert.equal(book.rows[0].kind, 'literacy_pre')
})

test('withdraw deletes by token hash and does not echo rows', async function(){
  const hash = await tokenHash(TOKEN)
  const book = admin({ rows: [{ study_id: STUDY, event_id: 'literacy_pre', token_hash: hash, kind: 'literacy_pre', score: 10 }] })
  const res = await handleEfficacy(call('POST', { action: 'withdraw', studyId: STUDY, token: TOKEN }), { admin: book })
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.deleted, 1)
  assert.equal(book.rows.length, 0)
  assert.equal(JSON.stringify(body).includes('literacy_pre'), false)
  const wrong = await handleEfficacy(call('POST', { action: 'withdraw', studyId: STUDY, token: TOKEN + 'no' }), { admin: book })
  const wrongBody = await wrong.json()
  assert.equal(wrongBody.deleted, 0)
})

test('a foreign origin is refused', async function(){
  const res = await handleEfficacy(call('GET', null, undefined, 'https://evil.example'), { admin: admin({}) })
  assert.equal(res.status, 403)
})
