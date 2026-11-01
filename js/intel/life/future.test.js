import { test } from 'node:test';
import assert from 'node:assert/strict';
import { futureLetter } from './future.js';

const path = {
  30: { portfolio: 8000, debt: 12000, netWorth: -4000 },
  45: { portfolio: 40000, debt: 0, netWorth: 40000 },
  65: { portfolio: 180000, debt: 0, netWorth: 180000 }
};
const alt = {
  30: { portfolio: 1000, debt: 12000, netWorth: -11000 },
  45: { portfolio: 22000, debt: 0, netWorth: 22000 },
  65: { portfolio: 90000, debt: 0, netWorth: 90000 }
};

test('future letter frames 65 and the what-if without advice', function(){
  const letter = futureLetter({
    dollars: 'today',
    ageNow: 16,
    pathLabel: 'age 16, in-state school, $50 a month',
    altLabel: 'Wait until 25',
    path: path,
    alt: alt,
    band: { p10: 60000, p50: 170000, p90: 420000 }
  });
  const text = [letter.title].concat(letter.paragraphs).join('\n');
  assert.match(letter.title, /65/);
  assert.match(text, /Hey/);
  assert.match(text, /180,000|180000/);
  assert.match(text, /Wait until 25/);
  assert.match(text, /90,000|90000/);
  assert.match(text, /60,000|60000/);
  assert.match(text, /420,000|420000/);
  assert.match(text, /postcard from age 30/i);
  assert.match(text, /postcard from age 45/i);
  assert.match(text, /not a reason to buy, sell, or borrow/i);
  assert.doesNotMatch(text, /you should|i recommend|buy this|sell your|borrow more|you need to/i);
});

test('future letter skips birthdays already behind the learner', function(){
  const letter = futureLetter({
    dollars: 'future',
    ageNow: 40,
    pathLabel: 'age 40',
    altLabel: '',
    path: path,
    alt: null,
    band: null
  });
  const text = letter.paragraphs.join('\n');
  assert.match(text, /future dollars/);
  assert.doesNotMatch(text, /postcard from age 30/i);
  assert.match(text, /postcard from age 45/i);
  assert.match(text, /not a reason to buy, sell, or borrow/i);
});
