/**
 * Reads a calendar feed (.ics, as Google Calendar's "Secret address in iCal
 * format" returns it) into simple event objects for parse.js:
 *   { id, title, description, location, date: 'YYYY-MM-DD', start: 'HH:mm', end: 'HH:mm' }
 * Dates and times are given in `tz` (default America/Chicago).
 *
 * Repeating events (RRULE) are not expanded: only their first date is used.
 * School jobs are single events, so this keeps the reader small.
 */
var HBICS = (function () {
  'use strict';

  function unfold(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  }

  function unescapeText(v) {
    return v.replace(/\\([\\,;nN])/g, function (m, c) { return c === 'n' || c === 'N' ? '\n' : c; });
  }

  /** Google puts HTML in descriptions made on the web: turn it into plain text. */
  function plain(v) {
    if (!/<[a-z][^>]*>/i.test(v)) return v;
    return v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  function parseLine(line) {
    var colon = -1, inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') inQuote = !inQuote;
      else if (ch === ':' && !inQuote) { colon = i; break; }
    }
    if (colon < 0) return null;
    var head = line.slice(0, colon).split(';');
    var params = {};
    head.slice(1).forEach(function (p) {
      var eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    });
    return { name: head[0].toUpperCase(), params: params, value: line.slice(colon + 1) };
  }

  var fmtCache = {};
  function partsIn(date, tz) {
    var f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }));
    var o = {};
    f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return { date: o.year + '-' + o.month + '-' + o.day, time: (o.hour === '24' ? '00' : o.hour) + ':' + o.minute };
  }

  /** UTC instant for a wall-clock time in a time zone. */
  function zonedToUtc(y, mo, d, h, mi, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi);
    for (var i = 0; i < 2; i++) {
      var p = partsIn(new Date(guess), tz);
      var pp = p.date.split('-').map(Number), tt = p.time.split(':').map(Number);
      var shown = Date.UTC(pp[0], pp[1] - 1, pp[2], tt[0], tt[1]);
      guess += Date.UTC(y, mo - 1, d, h, mi) - shown;
    }
    return new Date(guess);
  }

  /** -> { date, time } in tz; time '' for all-day. */
  function readWhen(prop, tz) {
    if (!prop) return null;
    var v = prop.value.trim();
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
    if (!m) return null;
    if (!m[4] || prop.params.VALUE === 'DATE') return { date: m[1] + '-' + m[2] + '-' + m[3], time: '' };
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
    var when;
    if (m[7]) when = new Date(Date.UTC(y, mo - 1, d, h, mi));
    else if (prop.params.TZID) {
      try { when = zonedToUtc(y, mo, d, h, mi, prop.params.TZID); } catch (e) { when = zonedToUtc(y, mo, d, h, mi, tz); }
    } else return { date: m[1] + '-' + m[2] + '-' + m[3], time: m[4] + ':' + m[5] }; // floating time
    return partsIn(when, tz);
  }

  function parse(text, tz) {
    tz = tz || 'America/Chicago';
    var events = [];
    var cur = null;
    unfold(text).split('\n').forEach(function (line) {
      if (line === 'BEGIN:VEVENT') { cur = {}; return; }
      if (line === 'END:VEVENT') {
        if (cur) events.push(cur);
        cur = null;
        return;
      }
      if (!cur) return;
      var p = parseLine(line);
      if (!p) return;
      if (!cur[p.name]) cur[p.name] = p; // first one wins
    });
    return events.map(function (e) {
      var start = readWhen(e.DTSTART, tz);
      if (!start) return null;
      if (e.STATUS && /CANCELLED/i.test(e.STATUS.value)) return null;
      var end = readWhen(e.DTEND, tz);
      var txt = function (k) { return e[k] ? plain(unescapeText(e[k].value)) : ''; };
      return {
        id: (e.UID ? e.UID.value : '') + (e['RECURRENCE-ID'] ? '/' + e['RECURRENCE-ID'].value : ''),
        title: txt('SUMMARY').trim(),
        description: txt('DESCRIPTION'),
        location: txt('LOCATION').trim(),
        date: start.date,
        start: start.time,
        end: end && end.date === start.date ? end.time : ''
      };
    }).filter(Boolean);
  }

  /** Today in tz as 'YYYY-MM-DD'. */
  function today(tz) { return partsIn(new Date(), tz || 'America/Chicago').date; }

  return { parse: parse, today: today };
})();

if (typeof module !== 'undefined') module.exports = HBICS;
