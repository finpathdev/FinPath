import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRecord, summarizeEfficacy, tokenHash, toDbRow, K_MIN } from './summary.ts'

const TOKEN = 'token-token-token-token-token-token'

function study(n: number){
  return 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12, '0')
}

function pre(id: string, score: number, band?: string){
  return { studyId: id, kind: 'literacy_pre', score, lessonPoints: 10, quizPoints: 0, breadthPoints: 0, ageBand: band || null, createdAt: '2026-11-01T00:00:00Z' }
}

function post(id: string, score: number, band?: string){
  return { studyId: id, kind: 'literacy_post', score, lessonPoints: 20, quizPoints: 10, breadthPoints: 10, ageBand: band || null, createdAt: '2026-11-08T00:00:00Z' }
}

test('fewer than k participants stay hidden, including the count', function(){
  const events = []
  for(let i = 0; i < K_MIN - 1; i++) events.push(pre(study(i), 10 + i, '16-17'))
  const summary = summarizeEfficacy(events, K_MIN)
  assert.equal(summary.enough, false)
  assert.equal(summary.message, 'Not enough participants yet')
  assert.equal(summary.participants, undefined)
  assert.equal(summary.literacy, undefined)
  assert.equal(summary.ageBands, undefined)
  const packed = JSON.stringify(summary)
  assert.equal(packed.includes(study(0)), false)
  assert.equal(packed.includes('aaaaaaaa'), false)
})

test('k participants publish means and hide a small age band', function(){
  const events = []
  for(let i = 0; i < 10; i++){
    events.push(pre(study(i), 20, i < 8 ? '16-17' : '13-15'))
    events.push(post(study(i), 40, i < 8 ? '16-17' : '13-15'))
  }
  const summary = summarizeEfficacy(events, 10)
  assert.equal(summary.enough, true)
  assert.equal(summary.participants, 10)
  assert.equal(summary.literacy && summary.literacy.preMean, 20)
  assert.equal(summary.literacy && summary.literacy.postMean, 40)
  assert.equal(summary.literacy && summary.literacy.deltaMean, 20)
  assert.equal(summary.ageBands, null)
  const packed = JSON.stringify(summary)
  for(let i = 0; i < 10; i++) assert.equal(packed.includes(study(i)), false)
})

test('a band is published only when every leftover group is also at least k', function(){
  const events = []
  for(let i = 0; i < 12; i++) events.push(pre(study(i), 30, '18-24'))
  const summary = summarizeEfficacy(events, 10)
  assert.equal(summary.ageBands && summary.ageBands[0].band, '18-24')
  assert.equal(summary.ageBands && summary.ageBands[0].participants, 12)
  const mixed = []
  for(let i = 0; i < 10; i++) mixed.push(pre(study(i), 30, '18-24'))
  for(let i = 10; i < 12; i++) mixed.push(pre(study(i), 30, '25+'))
  const hidden = summarizeEfficacy(mixed, 10)
  assert.equal(hidden.enough, true)
  assert.equal(hidden.ageBands, null)
  assert.equal(JSON.stringify(hidden).includes('"25+"'), false)
})

test('progress counts wait for k learners and do not list study ids', function(){
  const few = []
  for(let i = 0; i < 10; i++) few.push(pre(study(i), 10))
  for(let i = 0; i < 3; i++) few.push({ studyId: study(i), kind: 'progress', action: 'lesson_finished', createdAt: '2026-11-02T00:00:00Z' })
  const quiet = summarizeEfficacy(few, 10)
  assert.equal(quiet.progress, null)
  assert.equal(JSON.stringify(quiet).includes('3'), false)
  const many = few.slice()
  for(let i = 3; i < 10; i++) many.push({ studyId: study(i), kind: 'progress', action: 'quiz_finished', createdAt: '2026-11-02T00:00:00Z' })
  const shown = summarizeEfficacy(many, 10)
  assert.equal(shown.progress && shown.progress.learners, 10)
  assert.equal(shown.progress && shown.progress.lessons, 3)
  assert.equal(shown.progress && shown.progress.quizzes, 7)
})

test('a record without a 13+ attestation or with an email field is refused', async function(){
  const ok = parseRecord({
    action: 'record',
    studyId: study(1),
    token: TOKEN,
    ageConfirmed: '13plus',
    ageBand: '16-17',
    events: [{ eventId: 'literacy_pre', kind: 'literacy_pre', score: 12, lessonPoints: 4, quizPoints: 0, breadthPoints: 0 }],
  })
  assert.equal(ok.ok, true)
  if(!ok.ok) return
  const row = toDbRow(ok.studyId, await tokenHash(TOKEN), ok.events[0])
  assert.equal(row.token_hash.length, 64)
  assert.equal('user_id' in row, false)
  assert.equal(JSON.stringify(row).includes(TOKEN), false)
  const under = parseRecord({ action: 'record', studyId: study(1), token: TOKEN, ageConfirmed: 'under13', events: [] })
  assert.equal(under.ok, false)
  if(!under.ok) assert.equal(under.status, 403)
  const email = parseRecord({ action: 'record', studyId: study(1), token: TOKEN, ageConfirmed: '13plus', email: 'a@b.c', events: [] })
  assert.equal(email.ok, false)
  if(!email.ok) assert.equal(email.status, 400)
})
