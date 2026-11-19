/**
 * Local test server: serves the site and a stand-in for the calendar relay
 * that returns made-up jobs around today's date.
 *   node dev/server.js   then open http://localhost:8790
 * Paste any Google iCal link on the setup screen, e.g.
 *   https://calendar.google.com/calendar/ical/test%40example.com/private-0123abcd/basic.ics
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' };

function chicagoToday() {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day);
}
function ymd(days) { return new Date(chicagoToday() + days * 864e5).toISOString().slice(0, 10).replace(/-/g, ''); }
function esc(s) { return s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\;').replace(/\n/g, '\\n'); }

function fakeIcs() {
  const loc = (n, a) => `${n}, ${a}`;
  const list = [
    ['Travel → Cheek', 0, '0715', '0745', '', ''],
    ['Cheek – Boys Basketball (AM)', 1, '0800', '1100', loc('Cheek Middle School', '1500 Main St, Lake Dallas, TX 75065'), 'Original entry: "Cheek BBB. Corey Treiber"\nContact: Corey Treiber · ctreiber@example.org'],
    ['Between Cheek sessions (lunch)', 1, '1100', '1230', '', ''],
    ['Cheek – Boys Basketball (PM)', 1, '1230', '1500', loc('Cheek Middle School', '1500 Main St, Lake Dallas, TX 75065'), ''],
    ['Ryan – Girls & Boys Basketball (AM)', 4, '0800', '1100', loc('Ryan Middle School', '1200 Ryan Rd, Denton, TX'), ''],
    ['TENTATIVE Gunn – Boys Basketball', 5, '0900', '1100', '', ''],
    ['412 Oak Hollow Dr, Denton', 5, '1300', '1400', '', 'https://agent.foxtrotphoto.com/order/123'],
    ['Arbor Creek – Girls Basketball', 6, '0830', '1100', loc('Arbor Creek Middle School', '2109 Arbor Creek Dr, Carrollton, TX 75010'), ''],
    ['Bailey – 7th Girls & Boys Basketball', 8, '0800', '1000', loc('Bailey Junior High School', '2411 Winewood Ln, Arlington, TX'), ''],
    ['Bailey – 8th Girls Basketball', 8, '1000', '1100', loc('Bailey Junior High School', '2411 Winewood Ln, Arlington, TX'), ''],
    ['Bailey – 8th Boys Basketball', 8, '1100', '1200', loc('Bailey Junior High School', '2411 Winewood Ln, Arlington, TX'), ''],
    ['Shadow Ridge – All Boys', 12, '0730', '1100', loc('Shadow Ridge Middle School', '1000 Shadow Ridge Dr, Flower Mound, TX'), ''],
    ['McKamy – Boys (AM)', 15, '0800', '1100', loc('McKamy Middle School', '3101 Hollywood Dr, Flower Mound, TX'), ''],
    ['Gunn – Boys Basketball', 22, '0800', '1100', loc('Gunn Junior High School', '3000 S Fielder Rd, Arlington, TX'), ''],
    ['New Event', 22, '1500', '1600', '', '']
  ];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  list.forEach(([title, d, s, e, location, description], i) => {
    lines.push('BEGIN:VEVENT', `UID:ev${i}@test`, `DTSTART;TZID=America/Chicago:${ymd(d)}T${s}00`, `DTEND;TZID=America/Chicago:${ymd(d)}T${e}00`,
      `SUMMARY:${esc(title)}`, `LOCATION:${esc(location)}`, `DESCRIPTION:${esc(description)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

const port = Number(process.argv[2] || 8790);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/relay') {
    res.writeHead(200, { 'Content-Type': 'text/calendar' });
    res.end(fakeIcs());
    return;
  }
  if (url.pathname === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8') + "\nHB_CONFIG.relayUrl = '/relay';\n");
    return;
  }
  const file = path.join(ROOT, path.normalize(url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Foxtrot Handouts dev server: http://localhost:${port}`));
