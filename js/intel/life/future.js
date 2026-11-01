// A letter from "future you" inside the worksheet. Educational copy only.
// No buy, sell, or borrow instructions.

function money(n){
  if(!isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v < 0 ? '−' : '';
  return sign + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
}

function dollarWord(mode){
  return mode === 'future' ? 'future dollars, before adjusting for inflation' : "today's dollars";
}

function rowOf(bag, age){
  if(!bag) return null;
  const row = bag[age] || bag[String(age)] || null;
  if(!row || !isFinite(Number(row.portfolio))) return null;
  return row;
}

function postcard(age, ageNow, pathRow, altRow){
  if(!pathRow && !altRow) return '';
  const when = age === ageNow ? 'A postcard from right now, age ' + age : 'A postcard from age ' + age;
  let text = when + ': ';
  if(pathRow){
    text += 'the path on your screen shows about ' + money(pathRow.portfolio) + ' invested';
    if(Number(pathRow.debt) > 1) text += ', with about ' + money(pathRow.debt) + ' of debt still sitting in the model';
  }
  if(altRow){
    text += (pathRow ? '. The other worksheet shows about ' : 'the other worksheet shows about ') + money(altRow.portfolio) + ' invested';
  }
  text += '. Same kind of picture, different inputs. Not a score.';
  return text;
}

export function futureLetter(model){
  const src = model && typeof model === 'object' ? model : {};
  const ageNow = Number(src.ageNow);
  const dollars = src.dollars === 'future' ? 'future' : 'today';
  const pathLabel = String(src.pathLabel || 'the path on your screen');
  const altLabel = src.altLabel ? String(src.altLabel) : '';
  const path65 = rowOf(src.path, 65);
  const alt65 = rowOf(src.alt, 65);
  const band = src.band && isFinite(Number(src.band.p10)) && isFinite(Number(src.band.p90)) ? src.band : null;
  const paragraphs = [];

  const helloAge = isFinite(ageNow) ? ' I am glad you are looking at this while you are ' + ageNow + '.' : '';
  paragraphs.push('Hey. It is you at 65 — the version of you that lives inside this worksheet, not a fortune teller.' + helloAge);

  if(path65){
    let line = 'On the path on your screen (' + pathLabel + '), the steady line puts invested money around ' + money(path65.portfolio) + ' in ' + dollarWord(dollars) + '.';
    if(Number(path65.debt) > 1) line += ' The model still has about ' + money(path65.debt) + ' of debt at that birthday.';
    paragraphs.push(line);
  } else {
    paragraphs.push('This path does not have an age-65 snapshot yet. Check that the age on the Path tab is between 13 and 64.');
  }

  if(band && path65){
    paragraphs.push(
      'Markets do not move in a straight line, so the same deposits — using the sheet’s average return and a historical-size wobble — land between about ' +
      money(band.p10) + ' and ' + money(band.p90) + ' in this classroom exercise. The middle of that range is about ' +
      money(band.p50) + '. Those marks are percentiles (p10, p50, and p90), not a promise, and not a reason to buy, sell, or borrow.'
    );
  } else if(path65){
    paragraphs.push('The steady line is one rate from the assumptions sheet. It is not a promise, and not a reason to buy, sell, or borrow.');
  }

  if(altLabel && alt65){
    paragraphs.push(
      'I also peeked at the “' + altLabel + '” worksheet. That one shows about ' + money(alt65.portfolio) +
      ' invested at 65 on its own steady line. The size of that number is not a prize and not a verdict. It just shows how one change moves the picture.'
    );
  } else if(altLabel){
    paragraphs.push('The “' + altLabel + '” worksheet does not reach 65 from these ages, so there is no second number to set beside yours.');
  }

  [30, 45].forEach(function(age){
    if(isFinite(ageNow) && age < ageNow) return;
    const text = postcard(age, ageNow, rowOf(src.path, age), altLabel ? rowOf(src.alt, age) : null);
    if(text) paragraphs.push(text);
  });

  if(src.identityLabel){
    const score = Number(src.literacyScore);
    let line = 'The study profile saved on this device is ' + String(src.identityLabel) + '.';
    if(isFinite(score)) line += ' The literacy score is ' + Math.round(score) + ' out of 1000, from lessons and quizzes already saved in this browser.';
    line += ' That label only organizes what to study. It is not a reason to buy, sell, or borrow.';
    paragraphs.push(line);
  }

  paragraphs.push('The assumptions are listed on this page if you want to see where the rates came from. This letter does not know your real job, your family, or your luck. It is a note from a model.');

  return {
    title: 'A note from you at 65',
    paragraphs: paragraphs
  };
}
