/**
 * Calendar parsing: turns raw calendar events into handout jobs.
 *
 * Pure JavaScript with no Apps Script calls, so the same file runs on the
 * server (Apps Script) and in Node tests (test/parse.test.js).
 *
 * Input event shape (built by Code.js from CalendarApp):
 *   { id, title, description, location, date: 'YYYY-MM-DD', start: 'HH:mm', end: 'HH:mm' }
 */

var HB_SPORT_RULES = [
  { re: /\bcross\s*country\b|\bxc\b|\bcc\b/i, sport: 'Cross Country' },
  { re: /\bbbb\b/i, sport: 'Basketball', gender: 'b' },
  { re: /\bgbb\b/i, sport: 'Basketball', gender: 'g' },
  { re: /\bbasketball\b|\bbsk\b|\bb-?ball\b/i, sport: 'Basketball' },
  { re: /\bvolleyball\b|\bvb\b|\bv-?ball\b/i, sport: 'Volleyball' },
  { re: /\bfootball\b|\bfb\b/i, sport: 'Football' },
  { re: /\bsoccer\b/i, sport: 'Soccer' },
  { re: /\btrack\b/i, sport: 'Track' },
  { re: /\bbaseball\b/i, sport: 'Baseball' },
  { re: /\bsoftball\b/i, sport: 'Softball' },
  { re: /\btennis\b/i, sport: 'Tennis' },
  { re: /\bgolf\b/i, sport: 'Golf' },
  { re: /\bwrestling\b/i, sport: 'Wrestling' },
  { re: /\bswim(ming)?\b/i, sport: 'Swimming' },
  { re: /\bcheer(leading)?\b/i, sport: 'Cheer' }
];

var HB_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var HB_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** Lower-case key for matching school names and aliases. */
function HB_normKey(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Builds { normalized alias -> profile key } from the saved school profiles. */
function HB_aliasMap(profiles) {
  var map = {};
  Object.keys(profiles || {}).forEach(function (key) {
    var p = profiles[key];
    (p.aliases || []).forEach(function (a) {
      var n = HB_normKey(a);
      if (n) map[n] = key;
    });
  });
  return map;
}

/** Text Sally typed, from `Original entry: "…"` in the description. */
function HB_originalEntry(description) {
  var m = /Original entry:\s*["“”]([^"“”]*)["“”]/i.exec(String(description || ''));
  return m ? m[1].trim() : '';
}

/** Coach contact from `Contact: Name · email` in the description. */
function HB_coachContact(description) {
  var text = String(description || '').replace(/<[^>]+>/g, ' ');
  var m = /Contact:\s*([^·\n\r]*?)\s*·\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(text);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  var m2 = /Contact:[^\n\r]*?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(text);
  return m2 ? { name: '', email: m2[1] } : null;
}

/** True for events that never get a handout. */
function HB_isSkipped(title, description) {
  var t = String(title || '').trim();
  if (!t) return true;
  if (/^(travel|set\s*-?\s*up|between)\b/i.test(t)) return true;
  if (/^tentative/i.test(t)) return true;
  if (/^new event$/i.test(t)) return true;
  if (/^\d+\s+\S/.test(t)) return true; // house shoot: title starts with a street address
  if (/agent\.foxtrotphoto\.com/i.test(String(description || ''))) return true;
  return false;
}

/** Reads sports and genders from a piece of text (a title or Sally's note). */
function HB_readSportText(text) {
  var out = { sports: [], genders: {}, all: false };
  var s = String(text || '');
  HB_SPORT_RULES.forEach(function (r) {
    if (r.re.test(s)) {
      if (out.sports.indexOf(r.sport) < 0) out.sports.push(r.sport);
      if (r.gender) out.genders[r.gender] = true;
    }
  });
  // Basketball rules overlap (BBB + "basketball"): keep one entry.
  if (/\bboys?\b/i.test(s)) out.genders.b = true;
  if (/\bgirls?\b/i.test(s)) out.genders.g = true;
  if (/\b(b\s*(and|&|\/)\s*g|g\s*(and|&|\/)\s*b)\b/i.test(s)) { out.genders.b = true; out.genders.g = true; }
  if (/\ball\b/i.test(s)) out.all = true;
  return out;
}

/**
 * Parses one event. Returns null for anything that is not a school job.
 * @return {{school:string, key:string, session:string, sports:string[],
 *           genders:Object, all:boolean, fullName:string, typeLabel:string,
 *           address:string, coach:Object, original:string}|null}
 */
function HB_parseEvent(ev, aliasMap) {
  if (HB_isSkipped(ev.title, ev.description)) return null;
  var title = String(ev.title).trim();
  var session = '';
  var sm = /\s*\((AM|PM)\)\s*$/i.exec(title);
  if (sm) { session = sm[1].toUpperCase(); title = title.slice(0, sm.index).trim(); }

  var parts = title.split(/\s*[–—]\s*|\s+-\s+/);
  if (parts.length < 2) return null; // no "School – Sport" shape: personal or untitled
  var school = parts.shift().trim();
  var rest = parts.join(' ').trim();
  if (!school) return null;

  var read = HB_readSportText(rest);
  var original = HB_originalEntry(ev.description);
  if (original) {
    var fromNote = HB_readSportText(original);
    if (!read.sports.length) read.sports = fromNote.sports;
    if (!Object.keys(read.genders).length) read.genders = fromNote.genders;
    if (!read.all && !Object.keys(read.genders).length) read.all = fromNote.all;
  }

  var location = String(ev.location || '').trim();
  var fullName = location ? location.split(',')[0].trim() : '';
  var key = (aliasMap && aliasMap[HB_normKey(school)]) || HB_normKey(school);

  return {
    school: school,
    key: key,
    session: session,
    sports: read.sports,
    genders: read.genders,
    all: read.all,
    fullName: fullName,
    typeLabel: HB_typeLabel(fullName),
    address: location,
    coach: HB_coachContact(ev.description),
    original: original
  };
}

/** "JUNIOR HIGH" / "MIDDLE SCHOOL" etc. from the school's full name. */
function HB_typeLabel(fullName) {
  var n = String(fullName || '');
  if (/middle\s+school|\bms\b/i.test(n)) return 'MIDDLE SCHOOL';
  if (/junior\s+high|jr\.?\s*high/i.test(n)) return 'JUNIOR HIGH';
  if (/intermediate/i.test(n)) return 'INTERMEDIATE';
  if (/elementary/i.test(n)) return 'ELEMENTARY';
  if (/high\s+school|\bhs\b/i.test(n)) return 'HIGH SCHOOL';
  if (/academy/i.test(n)) return 'ACADEMY';
  return '';
}

/** Texas middle-school season default for a date and gender ('b', 'g' or ''). */
function HB_seasonSport(dateStr, gender) {
  var month = Number(String(dateStr).slice(5, 7));
  if (month >= 8 && month <= 10) return gender === 'g' ? 'Volleyball' : 'Football';
  if (month >= 11 || month === 1) return 'Basketball';
  if (month === 2) return gender === 'g' ? 'Softball' : 'Baseball';
  if (month === 3 || month === 4) return 'Soccer';
  return '';
}

/** 'Thursday October 15' */
function HB_longDate(dateStr) {
  var p = String(dateStr).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return HB_WEEKDAYS[d.getUTCDay()] + ' ' + HB_MONTHS[p[1] - 1] + ' ' + p[2];
}

/** 'FRIDAY 11/13' */
function HB_shortDate(dateStr) {
  var p = String(dateStr).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return HB_WEEKDAYS[d.getUTCDay()].toUpperCase() + ' ' + p[1] + '/' + p[2];
}

/**
 * Turns events into one job per school per day.
 * @param {Object[]} events  see file header
 * @param {Object} profiles  saved school profiles, keyed by school key
 */
function HB_buildJobs(events, profiles) {
  var aliases = HB_aliasMap(profiles);
  var groups = {};
  var order = [];
  (events || []).forEach(function (ev) {
    var p = HB_parseEvent(ev, aliases);
    if (!p) return;
    var id = ev.date + '|' + p.key;
    var g = groups[id];
    if (!g) {
      g = groups[id] = {
        id: id, date: ev.date, key: p.key, school: p.school,
        fullName: p.fullName, typeLabel: p.typeLabel, address: p.address,
        sports: [], genders: {}, all: false, sessions: [], coach: null, originals: []
      };
      order.push(id);
    }
    p.sports.forEach(function (s) { if (g.sports.indexOf(s) < 0) g.sports.push(s); });
    Object.keys(p.genders).forEach(function (k) { g.genders[k] = true; });
    if (p.all) g.all = true;
    if (!g.fullName && p.fullName) { g.fullName = p.fullName; g.typeLabel = p.typeLabel; g.address = p.address; }
    if (!g.coach && p.coach) g.coach = p.coach;
    if (p.original && g.originals.indexOf(p.original) < 0) g.originals.push(p.original);
    g.sessions.push({ eventId: ev.id, title: ev.title, start: ev.start || '', end: ev.end || '', session: p.session });
  });

  return order.map(function (id) {
    var g = groups[id];
    var genders = Object.keys(g.genders);
    var single = genders.length === 1 && !g.all ? genders[0] : '';
    var sports = g.sports.slice();
    var guessed = false;
    if (!sports.length) {
      var s = HB_seasonSport(g.date, genders.length === 1 ? genders[0] : '');
      if (s) sports = [s];
      guessed = true;
    }
    // "Basketball" already covers both teams when boys and girls are merged.
    var sport = sports.join(' & ');
    var sportLabel = sport ? (single === 'b' ? 'Boys ' : single === 'g' ? 'Girls ' : '') + sport : '';
    g.sessions.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    return {
      id: g.id,
      date: g.date,
      key: g.key,
      school: g.school,
      fullName: g.fullName,
      typeLabel: g.typeLabel,
      address: g.address,
      sport: sport,
      sportLabel: sportLabel,
      gender: single,
      sportGuessed: guessed,
      sessions: g.sessions,
      coachName: g.coach ? g.coach.name : '',
      coachEmail: g.coach ? g.coach.email : '',
      originals: g.originals
    };
  }).sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    var at = a.sessions[0] ? a.sessions[0].start : '';
    var bt = b.sessions[0] ? b.sessions[0].start : '';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    HB_buildJobs: HB_buildJobs, HB_parseEvent: HB_parseEvent, HB_isSkipped: HB_isSkipped,
    HB_seasonSport: HB_seasonSport, HB_longDate: HB_longDate, HB_shortDate: HB_shortDate,
    HB_coachContact: HB_coachContact, HB_typeLabel: HB_typeLabel, HB_normKey: HB_normKey
  };
}
