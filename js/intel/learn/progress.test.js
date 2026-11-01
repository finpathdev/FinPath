import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conceptsFor, LESSON_CONCEPTS, CONCEPTS } from './concepts.js';

test('every tagged lesson points at known concepts', function(){
  Object.keys(LESSON_CONCEPTS).forEach(function(slug){
    const ids = conceptsFor(slug);
    assert.ok(ids.length > 0, slug);
    ids.forEach(function(id){ assert.ok(CONCEPTS[id], slug + ' ' + id); });
  });
  assert.equal(Object.keys(LESSON_CONCEPTS).length, 34);
});
