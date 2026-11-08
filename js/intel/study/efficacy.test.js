import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  freshStudy, confirmAge, joinStudy, withdrawStudy, recordLiteracy, recordProgress,
  eventsToUpload, buildRecordBody, markUploaded, deletePayload, afterDelete, diffProgress
} from './efficacy.js';

const STUDY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = 'token-token-token-token-token-token';
const literacy = { score: 40, lessonPoints: 20, quizPoints: 10, breadthPoints: 10 };

function joined(){
  return joinStudy(confirmAge(freshStudy(), '13plus'), {
    agree: true,
    ageBand: '16-17',
    studyId: STUDY,
    token: TOKEN,
    now: 1000,
    literacy: literacy,
    lessons: { 'budget-50-30-20': 500 },
    quizIds: ['q1']
  }).state;
}

test('the study is off by default and under 13 cannot join or upload', function(){
  const fresh = freshStudy();
  assert.equal(fresh.status, 'off');
  assert.equal(eventsToUpload(fresh, true).length, 0);
  const blocked = confirmAge(fresh, 'under13');
  assert.equal(blocked.status, 'blocked');
  const refused = joinStudy(blocked, { agree: true, studyId: STUDY, token: TOKEN, now: 1, literacy: literacy });
  assert.equal(refused.error, 'blocked');
  assert.equal(refused.state.studyId, null);
  assert.equal(eventsToUpload(refused.state, true).length, 0);
  const unsigned = confirmAge(fresh, '13plus');
  assert.equal(joinStudy(unsigned, { agree: false, studyId: STUDY, token: TOKEN, now: 1 }).error, 'consent');
});

test('joining queues a pre score and signed-out upload is empty', function(){
  const state = joined();
  assert.equal(state.status, 'joined');
  assert.equal(state.pre.score, 40);
  assert.equal(state.ageBand, '16-17');
  assert.equal(eventsToUpload(state, false).length, 0);
  const body = buildRecordBody(state, true);
  assert.equal(body.ageConfirmed, '13plus');
  assert.equal(body.events[0].kind, 'literacy_pre');
  assert.equal(body.events[0].eventId, 'literacy_pre');
  const packed = JSON.stringify(body);
  assert.equal(packed.includes('email'), false);
  assert.equal(packed.includes('school'), false);
  assert.equal(packed.includes('user_id'), false);
  assert.equal(packed.includes('budget-50-30-20'), false);
  const same = recordLiteracy(state, literacy, 2000);
  assert.equal(same.post, null);
  const later = recordLiteracy(state, { score: 80, lessonPoints: 40, quizPoints: 20, breadthPoints: 20 }, 3000);
  assert.equal(later.post.score, 80);
  assert.equal(later.pending.filter(function(event){ return event.kind === 'literacy_post'; }).length, 1);
});

test('progress events after joining do not repeat and do not include the lesson slug', function(){
  const state = joined();
  const diff = diffProgress(state, { 'budget-50-30-20': 500, 'credit-scores': 800 }, ['q1', 'q2']);
  assert.equal(diff.added.length, 2);
  const again = diffProgress(diff.state, { 'budget-50-30-20': 500, 'credit-scores': 800 }, ['q1', 'q2']);
  assert.equal(again.added.length, 0);
  const body = buildRecordBody(again.state, true);
  const progress = body.events.filter(function(event){ return event.kind === 'progress'; });
  assert.equal(progress.length, 2);
  progress.forEach(function(event){
    assert.equal(JSON.stringify(event).includes('credit-scores'), false);
    assert.ok(event.action === 'lesson_finished' || event.action === 'quiz_finished');
  });
  const uploaded = markUploaded(again.state, progress.map(function(event){ return event.eventId; }));
  assert.equal(uploaded.pending.some(function(event){ return event.kind === 'progress'; }), false);
});

test('withdraw stops new events and delete keeps the study code until the server confirms', function(){
  const state = recordProgress(joined(), 'lesson_finished', 'credit-scores:1');
  const left = withdrawStudy(state);
  assert.equal(left.status, 'withdrawn');
  assert.equal(left.pending.length, 0);
  assert.equal(left.studyId, STUDY);
  assert.equal(eventsToUpload(left, true).length, 0);
  assert.equal(recordProgress(left, 'quiz_finished', 'q9'), left);
  const payload = deletePayload(left);
  assert.equal(payload.studyId, STUDY);
  assert.equal(payload.token, TOKEN);
  assert.equal(payload.action, 'withdraw');
  const cleared = afterDelete(left);
  assert.equal(cleared.status, 'off');
  assert.equal(cleared.studyId, null);
  assert.equal(deletePayload(cleared), null);
});

test('the consent screen is plain language, off by default, and blocks under 13', function(){
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const boot = readFileSync(new URL('./boot.js', import.meta.url), 'utf8');
  assert.match(html, /id="page-study"/);
  assert.match(html, /Does FinPath work\?/);
  assert.match(html, /under 13/i);
  assert.match(boot, /It is off unless you turn it on/);
  assert.match(boot, /not your name, email, school, or location/);
  assert.match(boot, /exact age/);
  assert.match(boot, /Delete my study data/);
  assert.match(boot, /Leave the study/);
  assert.match(boot, /id="studyAgree"/);
  assert.doesNotMatch(boot, /id="studyAgree"[^>]*checked/);
  assert.match(boot, /No, I am under 13/);
  const sw = readFileSync(new URL('../../../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /finpath-v38/);
  assert.match(sw, /js\/intel\/study\/efficacy\.js/);
  assert.match(sw, /js\/intel\/sync\/merge\.js/);
});
