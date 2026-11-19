// Run: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/parse.js');

const ev = (title, date, extra = {}) => Object.assign(
  { id: title + date, title, date, start: '09:00', end: '10:00', description: '', location: '' }, extra);

test('skips non-job events', () => {
  for (const t of ['Travel → Cheek', 'Set up – Cheek gym', 'Between Cheek sessions (lunch)',
    'TENTATIVE – Gunn – Boys Basketball', 'Tentative Ryan', 'New Event', '', 'Dentist',
    '1234 Elm St, Denton']) {
    assert.equal(P.HB_buildJobs([ev(t, '2026-12-03')], {}).length, 0, t);
  }
  assert.equal(P.HB_buildJobs([ev('Smith – Photos', '2026-12-03',
    { description: 'https://agent.foxtrotphoto.com/x' })], {}).length, 0);
});

test('merges AM and PM sessions into one handout', () => {
  const jobs = P.HB_buildJobs([
    ev('Cheek – Boys Basketball (PM)', '2026-12-03', { start: '13:00' }),
    ev('Cheek – Boys Basketball (AM)', '2026-12-03', { start: '08:00',
      location: 'Cheek Middle School, 100 Main St, Denton, TX' }),
  ], {});
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].school, 'Cheek');
  assert.equal(jobs[0].sportLabel, 'Boys Basketball');
  assert.equal(jobs[0].sportGuessed, false);
  assert.equal(jobs[0].typeLabel, 'MIDDLE SCHOOL');
  assert.deepEqual(jobs[0].sessions.map(s => s.session), ['AM', 'PM']);
});

test('mixed boys and girls drop gender; grades never shown', () => {
  const jobs = P.HB_buildJobs([
    ev('Bailey – 7th Girls & Boys Basketball', '2026-12-04'),
    ev('Bailey – 8th Girls Basketball', '2026-12-04'),
    ev('Bailey – 8th Boys Basketball', '2026-12-04'),
  ], {});
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].sportLabel, 'Basketball');
  assert.equal(P.HB_buildJobs([ev('Ryan – Girls & Boys Basketball (AM)', '2026-12-04')], {})[0].sportLabel, 'Basketball');
  assert.equal(P.HB_buildJobs([ev('Arbor Creek – Girls Basketball', '2026-12-04')], {})[0].sportLabel, 'Girls Basketball');
});

test('different days stay separate', () => {
  const jobs = P.HB_buildJobs([ev('Gunn – Boys Basketball', '2026-12-03'), ev('Gunn – Boys Basketball', '2026-12-10')], {});
  assert.equal(jobs.length, 2);
});

test('season default when no sport is written, with guessed flag', () => {
  let j = P.HB_buildJobs([ev('Shadow Ridge – All Boys', '2026-10-01')], {})[0];
  assert.equal(j.sportLabel, 'Football'); // "all" drops gender
  assert.equal(j.sportGuessed, true);
  j = P.HB_buildJobs([ev('McKamy – Boys (AM)', '2026-11-20')], {})[0];
  assert.equal(j.sportLabel, 'Boys Basketball');
  assert.equal(j.sportGuessed, true);
  j = P.HB_buildJobs([ev('Lake – Girls', '2026-09-10')], {})[0];
  assert.equal(j.sportLabel, 'Girls Volleyball');
  j = P.HB_buildJobs([ev('Lake – Girls', '2027-02-10')], {})[0];
  assert.equal(j.sportLabel, 'Girls Softball');
  j = P.HB_buildJobs([ev('Lake – Boys', '2027-02-10')], {})[0];
  assert.equal(j.sportLabel, 'Boys Baseball');
  j = P.HB_buildJobs([ev('Lake – Team', '2027-03-10')], {})[0];
  assert.equal(j.sportLabel, 'Soccer');
  j = P.HB_buildJobs([ev('Lake – Team', '2027-06-10')], {})[0];
  assert.equal(j.sportLabel, '');
  assert.equal(j.sportGuessed, true);
});

test('falls back to the Original entry note and abbreviations', () => {
  let j = P.HB_buildJobs([ev('Cheek – Team photos', '2026-09-03',
    { description: 'Original entry: "Cheek BBB. Corey Treiber"' })], {})[0];
  assert.equal(j.sportLabel, 'Boys Basketball');
  assert.equal(j.sportGuessed, false);
  j = P.HB_buildJobs([ev('Hodge – x', '2026-09-03', { description: 'Original entry: “Hodge vb G & B”' })], {})[0];
  assert.equal(j.sportLabel, 'Volleyball');
  j = P.HB_buildJobs([ev('Hodge – GBB', '2026-12-03')], {})[0];
  assert.equal(j.sportLabel, 'Girls Basketball');
  j = P.HB_buildJobs([ev('Hodge – xc', '2026-09-03')], {})[0];
  assert.equal(j.sportLabel, 'Cross Country');
  j = P.HB_buildJobs([ev('Hodge – Boys FB', '2026-09-03')], {})[0];
  assert.equal(j.sportLabel, 'Boys Football');
  j = P.HB_buildJobs([ev('Hodge – bsk', '2026-12-03')], {})[0];
  assert.equal(j.sportLabel, 'Basketball');
});

test('aliases map titles onto one school', () => {
  const profiles = { 'arbor creek': { key: 'arbor creek', name: 'Arbor Creek', aliases: ['ACMS'] } };
  const jobs = P.HB_buildJobs([ev('ACMS – Boys Basketball (AM)', '2026-12-03'),
    ev('Arbor Creek – Girls Basketball (PM)', '2026-12-03')], profiles);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].key, 'arbor creek');
  assert.equal(jobs[0].sportLabel, 'Basketball');
});

test('coach contact and dates', () => {
  const c = P.HB_coachContact('Notes\nContact: Corey Treiber · ctreiber@school.org\n');
  assert.deepEqual(c, { name: 'Corey Treiber', email: 'ctreiber@school.org' });
  assert.equal(P.HB_longDate('2026-10-15'), 'Thursday October 15');
  assert.equal(P.HB_longDate('2026-12-03'), 'Thursday December 3');
  assert.equal(P.HB_shortDate('2026-11-13'), 'FRIDAY 11/13');
  assert.equal(P.HB_typeLabel('Bedford Junior High School'), 'JUNIOR HIGH');
});
