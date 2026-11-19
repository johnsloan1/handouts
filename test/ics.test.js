const test = require('node:test');
const assert = require('node:assert/strict');
const ICS = require('../js/ics.js');

const feed = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART:20261119T140000Z',
  'DTEND:20261119T170000Z',
  'UID:a1@google.com',
  'SUMMARY:Cheek – Boys Basketball (AM)',
  'LOCATION:Cheek Middle School\\, 1500 Main St\\, Lake Dallas\\, TX 75065',
  'DESCRIPTION:Original entry: "Cheek BBB. Corey Treiber"\\nContact: Corey Treiber',
  '  · ctreiber@example.org',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/Chicago:20261120T083000',
  'DTEND;TZID=America/Chicago:20261120T110000',
  'UID:a2@google.com',
  'SUMMARY:Ryan – Girls & Boys Basketball',
  'DESCRIPTION:<b>Notes</b><br>Bring lights &amp; stands',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261121',
  'DTEND;VALUE=DATE:20261122',
  'UID:a3@google.com',
  'SUMMARY:Day off',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261122T140000Z',
  'UID:a4@google.com',
  'STATUS:CANCELLED',
  'SUMMARY:Gunn – Boys Basketball',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

test('reads Google Calendar events in Central time', () => {
  const ev = ICS.parse(feed);
  assert.equal(ev.length, 3);
  assert.deepEqual(
    { date: ev[0].date, start: ev[0].start, end: ev[0].end, title: ev[0].title, location: ev[0].location },
    { date: '2026-11-19', start: '08:00', end: '11:00', title: 'Cheek – Boys Basketball (AM)', location: 'Cheek Middle School, 1500 Main St, Lake Dallas, TX 75065' });
  assert.match(ev[0].description, /Contact: Corey Treiber · ctreiber@example.org/);
  assert.equal(ev[1].start, '08:30');
  assert.equal(ev[1].description, 'Notes\nBring lights & stands');
  assert.deepEqual([ev[2].date, ev[2].start], ['2026-11-21', '']);
});
