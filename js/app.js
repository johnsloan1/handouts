/* Foxtrot Handouts: the whole app runs in the browser.
 *
 * - Calendar: the person's own Google Calendar secret iCal link, saved on
 *   this device and fetched through the relay (HB_CONFIG.relayUrl).
 * - Schools: shared defaults from data/schools.json (+ logos/), with
 *   changes made here saved on this device.
 * - Email: opens the person's own email app; nothing is sent by the page.
 */
(function () {
  'use strict';

  var CFG = HB_CONFIG;
  var DEFAULT_COLORS = { primary: '#B3121F', secondary: '#0B2A5B', accent: '#B3121F' };
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var ICS_LINK = /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^/]+\/(private-[0-9a-f]+|public)\/basic\.ics$/;

  var S = {
    view: 'jobs', jobs: null, shared: {}, loading: false, error: '', updatedAt: null,
    selected: {}, images: {}, paperBody: null, today: HBICS.today(CFG.timeZone), window: null
  };

  // ---------------------------------------------------------------- saved on this device

  var memory = {};
  function lsGet(k) { try { var v = window.localStorage.getItem(k); return v == null ? memory[k] || null : v; } catch (e) { return memory[k] || null; } }
  function lsSet(k, v) {
    if (v == null) delete memory[k]; else memory[k] = v;
    try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function loadLocal() {
    var d = {};
    try { d = JSON.parse(lsGet('hb.local') || '{}'); } catch (e) { d = {}; }
    d.settings = d.settings || {};
    d.schools = d.schools || {};
    d.edits = d.edits || {};
    return d;
  }
  var L = loadLocal();
  function saveLocal() {
    // Forget edits for jobs more than 60 days old.
    var cutoff = addDays(S.today, -60);
    Object.keys(L.edits).forEach(function (id) { if (id.slice(0, 10) < cutoff) delete L.edits[id]; });
    if (!lsSet('hb.local', JSON.stringify(L))) toast('This browser won\'t save changes (private browsing?).', true);
  }
  function setting(k) { return L.settings[k] != null ? L.settings[k] : CFG[k]; }
  function calendarLink() { return lsGet('hb.calendar') || ''; }

  // ---------------------------------------------------------------- tiny DOM helpers

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(function (x) { append(el, x); });
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }

  var ICONS = {
    refresh: 'M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    print: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
    mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
    share: 'M12 15V4M8 8l4-4 4 4M5 12v7h14v-7',
    upload: 'M12 16V5M7 10l5-5 5 5M5 20h14'
  };
  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONS[name]);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, isErr ? 6000 : 3500);
  }

  var busyEl = null;
  function busy(msg) {
    if (msg == null) { if (busyEl) busyEl.remove(); busyEl = null; return; }
    if (!busyEl) {
      busyEl = h('div', { class: 'busy' }, h('div', { class: 'busy-box' }, h('div', { class: 'spinner' }), h('div', { class: 'msg' })));
      document.body.appendChild(busyEl);
    }
    busyEl.querySelector('.msg').textContent = msg;
  }

  function fail(err) {
    busy();
    toast(err && err.message || String(err), true);
  }

  // ---------------------------------------------------------------- dates

  function parts(d) { var p = d.split('-').map(Number); return { y: p[0], m: p[1], d: p[2], dow: new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() }; }
  function addDays(d, n) { var p = parts(d); return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10); }
  function monday(d) { var dow = parts(d).dow; return addDays(d, dow === 0 ? -6 : 1 - dow); }
  function md(d) { var p = parts(d); return p.m + '/' + p.d; }
  function dayAbbr(d) { return WEEKDAYS[parts(d).dow].slice(0, 3).toUpperCase(); }
  function dayShort(d) { var a = dayAbbr(d); return a.charAt(0) + a.slice(1).toLowerCase(); }
  function monthDay(d) { var p = parts(d); return MONTHS[p.m - 1].slice(0, 3) + ' ' + p.d; }
  function fmtTime(t) {
    if (!t) return '';
    var p = t.split(':').map(Number);
    return ((p[0] + 11) % 12 + 1) + ':' + ('0' + p[1]).slice(-2) + (p[0] < 12 ? ' AM' : ' PM');
  }
  function calendarWindow() {
    var from = S.today;
    var to = addDays(from, setting('weeks') * 7 - 1);
    var dow = parts(to).dow;
    if (dow !== 0) to = addDays(to, 7 - dow);
    return { from: from, to: to };
  }

  // ---------------------------------------------------------------- schools

  /** A school's settings: calendar defaults < shared file < this device. */
  function profileOf(job) {
    var shared = S.shared[job.key] || {};
    var mine = L.schools[job.key] || {};
    var p = {
      key: job.key, name: job.school, typeLabel: job.typeLabel, fullName: job.fullName, address: job.address,
      colors: DEFAULT_COLORS, logo: '', mirrorLogo: false, lastMode: 'paper', aliases: []
    };
    [shared, mine].forEach(function (src) {
      Object.keys(src).forEach(function (k) { if (src[k] != null && k !== 'logoLocal') p[k] = src[k]; });
    });
    if (mine.logoLocal) p.logo = 'local:' + job.key;
    if (mine.logoRemoved) p.logo = '';
    return p;
  }

  /** Alias lookups for parse.js: shared and local aliases together. */
  function aliasProfiles() {
    var out = {};
    [S.shared, L.schools].forEach(function (src) {
      Object.keys(src).forEach(function (k) {
        out[k] = out[k] || { aliases: [] };
        out[k].aliases = out[k].aliases.concat(src[k].aliases || []);
      });
    });
    return out;
  }

  function knownSchools() {
    var keys = {};
    (S.jobs || []).forEach(function (j) { keys[j.key] = j; });
    Object.keys(S.shared).forEach(function (k) { if (!keys[k]) keys[k] = { key: k, school: S.shared[k].name || k, typeLabel: '', fullName: '', address: '' }; });
    return Object.keys(keys).map(function (k) { return profileOf(keys[k]); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function getLogo(p) {
    var src = p.logo;
    if (!src) return Promise.resolve(null);
    if (src.indexOf('local:') === 0) src = lsGet('hb.logo.' + src.slice(6));
    if (!src) return Promise.resolve(null);
    if (!S.images[src]) {
      S.images[src] = HBR.loadImage(src).catch(function (e) { delete S.images[src]; throw e; });
    }
    return S.images[src].catch(function () { return null; });
  }

  function getPaperBody() {
    if (!S.paperBody) S.paperBody = HBR.loadImage('assets/paper-body.png').catch(function (e) { S.paperBody = null; throw e; });
    return S.paperBody;
  }

  // ---------------------------------------------------------------- jobs: resolved text

  function editsOf(job) { return L.edits[job.id] || {}; }

  function shortDate(d) { var p = parts(d); return WEEKDAYS[p.dow].toUpperCase() + ' ' + p.m + '/' + p.d; }

  /** The handout text and look for a job: calendar + school + edits. */
  function resolve(job, ignoreEdits) {
    var pr = profileOf(job);
    var e = ignoreEdits ? {} : editsOf(job);
    var pick = function (k, def) { return e[k] != null ? e[k] : def; };
    return {
      mode: editsOf(job).mode || pr.lastMode || 'paper',
      dateLine: pick('dateLine', HB_longDate(job.date)),
      takingLine: pick('takingLine', 'we will be taking'),
      titleLine: pick('titleLine', [pr.name, job.sportLabel, 'Photos'].filter(Boolean).join(' ')),
      oName: pick('oName', pr.name),
      oType: pick('oType', pr.typeLabel || ''),
      oSport: pick('oSport', job.sportLabel),
      oDate: pick('oDate', shortDate(job.date)),
      colors: e.colors || pr.colors || DEFAULT_COLORS,
      noLogo: !!e.noLogo,
      profile: pr
    };
  }

  function isEdited(job) {
    return Object.keys(editsOf(job)).some(function (k) { return k !== 'mode'; });
  }

  function label(job) { return profileOf(job).name + (job.sportLabel ? ' ' + job.sportLabel : ''); }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim(); }

  function outputsFor(job) {
    var base = safeName(job.date + ' ' + profileOf(job).name + ' ' + (job.sportLabel || ''));
    if (resolve(job).mode === 'online') return [{ kind: 'online', name: base + ' - Online.jpg' }];
    return [{ kind: 'full', name: base + ' - Paper Full.jpg' }, { kind: 'half', name: base + ' - Paper Half.jpg' }];
  }

  /** Everything the renderer needs (r = resolved text, maybe a draft). */
  function drawData(r) {
    if (r.mode === 'online') {
      return (r.noLogo ? Promise.resolve(null) : getLogo(r.profile)).then(function (logo) {
        return { name: r.oName, type: r.oType, sport: r.oSport, date: r.oDate, colors: r.colors, logo: logo, mirrorLogo: !!r.profile.mirrorLogo };
      });
    }
    return getPaperBody().then(function (body) {
      return { dateLine: r.dateLine, takingLine: r.takingLine, titleLine: r.titleLine, body: body, rotateRight: !!setting('rotateHalfRight') };
    });
  }

  /** Renders 300 dpi JPEGs, one at a time to keep phone memory low. */
  function makeFiles(jobs, onEach) {
    var files = [], list = [];
    jobs.forEach(function (job) { outputsFor(job).forEach(function (o) { list.push({ job: job, out: o }); }); });
    var chain = HBR.ensureFonts();
    list.forEach(function (item, i) {
      chain = chain.then(function () {
        if (onEach) onEach(i, list.length);
        return drawData(resolve(item.job));
      }).then(function (d) {
        return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
          var canvas = HBR.render(item.out.kind, d, 300);
          return HBR.toJpeg(canvas, 300, 0.9).then(function (blob) {
            canvas.width = canvas.height = 0;
            files.push({ job: item.job, kind: item.out.kind, name: item.out.name, blob: blob });
          });
        });
      });
    });
    return chain.then(function () { return files; });
  }

  function selectedJobs() { return (S.jobs || []).filter(function (j) { return S.selected[j.id]; }); }

  function rememberModes(jobs) {
    jobs.forEach(function (j) {
      var mine = L.schools[j.key] = L.schools[j.key] || {};
      mine.lastMode = resolve(j).mode;
    });
    saveLocal();
  }

  function progress(prefix) { return function (i, n) { busy(prefix + ' ' + (i + 1) + ' of ' + n + '…'); }; }

  // ---------------------------------------------------------------- download, print, email

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function zipName(jobs, files) {
    if (jobs.length === 1) return 'Handouts ' + safeName(files[0].name.replace(/ - (Paper (Full|Half)|Online)\.jpg$/, '')) + '.zip';
    return 'Handouts ' + jobs[0].date + '.zip';
  }

  /** Saves the files: one JPEG as is, several as a .zip. */
  function saveFiles(jobs, files) {
    if (files.length === 1) { saveBlob(files[0].blob, files[0].name); return Promise.resolve(); }
    return HBZip.make(files).then(function (zip) { saveBlob(zip, zipName(jobs, files)); });
  }

  function doDownload() {
    var jobs = selectedJobs();
    if (!jobs.length) return;
    makeFiles(jobs, progress('Making file')).then(function (files) {
      busy('Saving…');
      return saveFiles(jobs, files).then(function () {
        busy();
        toast(files.length === 1 ? 'Downloaded ' + files[0].name : 'Downloaded ' + files.length + ' files');
        rememberModes(jobs);
      });
    }).catch(fail);
  }

  function doPrint() {
    var jobs = selectedJobs();
    if (!jobs.length) return;
    var named = !!(window.CSS && CSS.supports && CSS.supports('page', 'landscape'));
    makeFiles(jobs, progress('Making page')).then(function (files) {
      busy('Opening print…');
      var root = document.getElementById('print-root');
      root.textContent = '';
      var loads = files.map(function (f) {
        var img = h('img', { alt: '' });
        var land = f.kind === 'half';
        root.appendChild(h('div', { class: 'pg' + (land ? (named ? ' land' : ' rot') : '') }, img));
        return new Promise(function (res) { img.onload = img.onerror = res; img.src = URL.createObjectURL(f.blob); });
      });
      return Promise.all(loads).then(function () {
        busy();
        rememberModes(jobs);
        setTimeout(function () { window.print(); }, 50);
      });
    }).catch(fail);
  }

  function jobLine(job) {
    return '• ' + dayShort(job.date) + ' ' + md(job.date) + ' – ' + label(job) + ' – ' +
      (resolve(job).mode === 'online' ? 'Online' : 'Paper (full sheet + half sheet)');
  }

  /**
   * Hands the files to the person's own email app. A mailto: link can't carry
   * attachments, so: "Share" (iPhone, iPad, Mac Safari) gives Mail the files
   * already attached; "Open email app" starts the email and downloads the files
   * to attach. Both need a fresh tap, so they're buttons on a sheet.
   */
  function openMailSheet(m) {
    var shareFiles = m.files.map(function (f) { return new File([f.blob], f.name, { type: f.blob.type || 'image/jpeg' }); });
    var canShare = false;
    try { canShare = !!(navigator.canShare && navigator.canShare({ files: shareFiles })); } catch (e) { canShare = false; }
    var mailto = 'mailto:' + encodeURIComponent(m.to).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);
    var saved = false;
    var saveOnce = function () { if (!saved) { saved = true; saveFiles(m.jobs, m.files).catch(fail); } };
    var n = m.files.length;
    var body = h('div', { class: 'sheet-body one' }, h('div', { class: 'fields' },
      h('div', { class: 'details' },
        h('div', {}, h('b', { text: 'To: ' }), m.toLabel || m.to),
        h('div', {}, h('b', { text: 'Subject: ' }), m.subject),
        h('div', {}, h('b', { text: 'Attach: ' }), n + ' file' + (n > 1 ? 's' : ''))),
      canShare ? h('button', {
        class: 'btn primary', onclick: function () {
          navigator.share({ files: shareFiles, title: m.subject, text: m.body }).then(function () { rememberModes(m.jobs); }).catch(function (e) {
            if (e && e.name !== 'AbortError') toast('Sharing didn\'t work. Use "Open email app" instead.', true);
          });
        }
      }, icon('share'), 'Share to Mail (files attached)') : null,
      canShare ? h('div', { class: 'hint', text: 'Pick Mail, then type ' + (m.toLabel || m.to) + ' in the To line.' }) : null,
      h('a', {
        class: 'btn' + (canShare ? '' : ' primary'), href: mailto, style: 'text-decoration:none;justify-content:center',
        onclick: function () { saveOnce(); rememberModes(m.jobs); }
      }, icon('mail'), 'Open email app'),
      h('div', { class: 'hint', text: 'Starts the email with the address and subject filled in, and downloads the ' +
        (n > 1 ? 'files as a .zip' : 'file') + '. Attach ' + (n > 1 ? 'them' : 'it') + ' from your Downloads folder.' })));
    openSheet(m.title, body, h('div', { class: 'sheet-foot' }, h('button', { class: 'btn', text: 'Done', onclick: closeSheet })));
  }

  function doEmailSally() {
    var jobs = selectedJobs();
    if (!jobs.length) return;
    makeFiles(jobs, progress('Making file')).then(function (files) {
      busy();
      openMailSheet({
        title: 'Email to Sally', to: setting('sallyEmail'), subject: CFG.emailSubject, files: files, jobs: jobs,
        body: 'Hi Sally,\n\nHere ' + (jobs.length === 1 ? 'is the handout' : 'are the handouts') + ':\n\n' + jobs.map(jobLine).join('\n') + '\n'
      });
    }).catch(fail);
  }

  function doEmailCoach(job) {
    makeFiles([job], progress('Making file')).then(function (files) {
      busy();
      openMailSheet({
        title: 'Email to coach', to: job.coachEmail, toLabel: (job.coachName ? job.coachName + ' ' : '') + '<' + job.coachEmail + '>',
        subject: 'Picture day – ' + label(job) + ' (' + md(job.date) + ')', files: files, jobs: [job],
        body: 'Hi' + (job.coachName ? ' ' + job.coachName.split(' ')[0] : '') + ',\n\nAttached is the picture-day handout for ' +
          HB_longDate(job.date) + '.\n\nThank you!\nJohn Sloan\nFoxtrot Photography\n'
      });
    }).catch(fail);
  }

  // ---------------------------------------------------------------- loading

  function loadShared() {
    return fetch('data/schools.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (d) { S.shared = d || {}; });
  }

  function loadJobs() {
    var link = calendarLink();
    if (!link) { S.view = 'setup'; render(); return Promise.resolve(); }
    if (!CFG.relayUrl) { S.error = 'The calendar relay isn\'t set up yet (relayUrl in js/config.js).'; render(); return Promise.resolve(); }
    S.loading = true; S.error = '';
    S.today = HBICS.today(CFG.timeZone);
    render();
    var url = CFG.relayUrl + (CFG.relayUrl.indexOf('?') < 0 ? '?' : '&') + 'url=' + encodeURIComponent(link);
    return Promise.all([
      loadShared(),
      fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) {
        return r.text().then(function (t) {
          if (!r.ok) throw new Error(t || 'Could not read the calendar.');
          if (t.indexOf('BEGIN:VCALENDAR') < 0) throw new Error('That link didn\'t return a calendar. Check it in Settings.');
          return t;
        });
      }, function () { throw new Error('Could not reach the calendar. Check your internet connection.'); })
    ]).then(function (res) {
      S.window = calendarWindow();
      var events = HBICS.parse(res[1], CFG.timeZone).filter(function (e) { return e.date >= S.window.from && e.date <= S.window.to; });
      S.jobs = HB_buildJobs(events, aliasProfiles());
      S.loading = false; S.updatedAt = new Date();
      var ids = {};
      S.jobs.forEach(function (j) { ids[j.id] = true; });
      Object.keys(S.selected).forEach(function (id) { if (!ids[id]) delete S.selected[id]; });
      render();
    }).catch(function (e) {
      S.loading = false; S.error = e.message;
      render();
    });
  }

  // ---------------------------------------------------------------- main render

  function render() {
    var app = document.getElementById('app');
    var scroll = window.scrollY;
    app.textContent = '';
    if (S.view === 'setup') { renderSetup(app); return; }
    app.appendChild(topBar());
    var main = h('main');
    if (S.view === 'jobs') renderJobs(main);
    else if (S.view === 'schools') renderSchools(main);
    else if (S.view === 'settings') renderSettings(main);
    app.appendChild(main);
    app.appendChild(actionBar());
    window.scrollTo(0, scroll);
  }

  function topBar() {
    var tabs = [['jobs', 'Jobs'], ['schools', 'Schools'], ['settings', 'Settings']];
    return h('header', { class: 'top' },
      h('div', { class: 'top-in' },
        h('div', { class: 'brand' }, 'Foxtrot Handouts'),
        S.view === 'jobs' ? h('button', { class: 'icon-btn', title: 'Re-read the calendar', 'aria-label': 'Refresh', onclick: loadJobs }, icon('refresh'), h('span', { text: 'Refresh' })) : null),
      h('nav', { class: 'tabs' }, tabs.map(function (t) {
        return h('button', {
          class: 'tab', 'aria-current': S.view === t[0] ? 'page' : null, text: t[1],
          onclick: function () { S.view = t[0]; render(); }
        });
      })));
  }

  // ---------------------------------------------------------------- first-time setup

  function normalizeLink(v) {
    v = String(v || '').trim().replace(/^webcal:\/\//i, 'https://');
    return v;
  }

  function renderSetup(app) {
    var err = h('div', { class: 'error' });
    var input = h('input', { type: 'url', id: 'cal', autocomplete: 'off', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', value: calendarLink() });
    var form = h('form', {
      onsubmit: function (ev) {
        ev.preventDefault();
        var v = normalizeLink(input.value);
        if (!ICS_LINK.test(v)) { err.textContent = 'That doesn\'t look like a Google Calendar iCal link. It starts with https://calendar.google.com/calendar/ical/ and ends with basic.ics'; return; }
        lsSet('hb.calendar', v);
        S.view = 'jobs';
        loadJobs();
      }
    }, h('div', { class: 'field' }, h('label', { for: 'cal', text: 'Calendar link' }), input),
    h('button', { class: 'btn primary', type: 'submit', text: 'Save and show jobs' }), err,
    calendarLink() ? h('button', { type: 'button', class: 'link-btn', style: 'margin-top:12px', text: 'Cancel', onclick: function () { S.view = 'jobs'; loadJobs(); } }) : null);
    app.appendChild(h('div', { class: 'signin', style: 'max-width:520px' },
      h('h1', { text: 'Foxtrot Handouts' }),
      h('p', { text: 'Add the calendar once on this device. It stays saved here and isn\'t shared with anyone.' }),
      h('ol', { class: 'steps' },
        h('li', { text: 'On a computer, open Google Calendar.' }),
        h('li', { text: 'On the left, point at the calendar (Houses - Foxtrot), click ⋮ then "Settings and sharing".' }),
        h('li', { text: 'Scroll to "Secret address in iCal format" and copy it.' }),
        h('li', { text: 'Paste it below.' })),
      form));
    setTimeout(function () { input.focus(); }, 50);
  }

  // ---------------------------------------------------------------- jobs list

  function renderJobs(main) {
    if (S.loading && !S.jobs) { main.appendChild(h('div', { class: 'empty', text: 'Reading the calendar…' })); return; }
    if (S.error && !S.jobs) {
      main.appendChild(h('div', { class: 'empty' }, h('p', { text: S.error }),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn', text: 'Try again', onclick: loadJobs }),
          h('button', { class: 'btn', text: 'Change calendar link', onclick: function () { S.view = 'setup'; render(); } }))));
      return;
    }
    if (!S.jobs) return;
    main.appendChild(h('p', { class: 'meta' },
      h('span', { text: monthDay(S.window.from) + ' – ' + monthDay(S.window.to) }),
      h('span', { text: '·' }),
      h('span', { text: S.loading ? 'Refreshing…' : S.error ? 'Refresh failed: ' + S.error : 'Updated ' + S.updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })));
    if (!S.jobs.length) {
      main.appendChild(h('div', { class: 'empty', text: 'No school jobs on the calendar in the next ' + setting('weeks') + ' weeks.' }));
      return;
    }
    var weeks = {}, order = [];
    S.jobs.forEach(function (j) {
      var w = monday(j.date);
      if (!weeks[w]) { weeks[w] = []; order.push(w); }
      weeks[w].push(j);
    });
    var thisMon = monday(S.today);
    order.forEach(function (w) {
      var jobs = weeks[w];
      var all = jobs.every(function (j) { return S.selected[j.id]; });
      var some = jobs.some(function (j) { return S.selected[j.id]; });
      var title = w === thisMon ? 'This week' : w === addDays(thisMon, 7) ? 'Next week' : 'Week of ' + monthDay(w);
      var master = h('input', {
        type: 'checkbox', checked: all, 'aria-label': 'Select all jobs in ' + title,
        onchange: function () {
          jobs.forEach(function (j) { if (master.checked) S.selected[j.id] = true; else delete S.selected[j.id]; });
          render();
        }
      });
      master.indeterminate = some && !all;
      main.appendChild(h('section', { class: 'week' },
        h('div', { class: 'week-head' }, master,
          h('h2', { text: title }),
          h('span', { class: 'count', text: monthDay(w) + ' – ' + monthDay(addDays(w, 6)) + ' · ' + jobs.length + ' job' + (jobs.length > 1 ? 's' : '') })),
        h('div', { class: 'jobs' }, jobs.map(jobRow))));
    });
  }

  function setMode(job, mode) {
    var e = L.edits[job.id] = L.edits[job.id] || {};
    e.mode = mode;
    var mine = L.schools[job.key] = L.schools[job.key] || {};
    mine.lastMode = mode;
    saveLocal();
  }

  function jobRow(job) {
    var r = resolve(job);
    var sel = !!S.selected[job.id];
    var times = job.sessions.map(function (s) { return fmtTime(s.start); }).filter(String);
    var pick = function (mode) { if (r.mode !== mode) { setMode(job, mode); render(); } };
    return h('div', { class: 'job' + (sel ? ' sel' : '') },
      h('input', {
        type: 'checkbox', checked: sel, 'aria-label': 'Select ' + label(job),
        onchange: function (ev) { if (ev.target.checked) S.selected[job.id] = true; else delete S.selected[job.id]; render(); }
      }),
      h('div', { class: 'day' }, h('b', { text: dayAbbr(job.date) }), h('span', { text: md(job.date) })),
      h('div', { class: 'info' },
        h('div', { class: 'school', text: r.profile.name }),
        h('div', { class: 'sport' },
          h('span', { text: job.sportLabel || 'Sport not found' }),
          job.sportGuessed ? h('span', { class: 'flag', title: 'No sport on the calendar: guessed from the season', text: 'sport guessed' }) : null,
          isEdited(job) ? h('span', { class: 'edited', text: 'edited' }) : null),
        times.length ? h('div', { class: 'times', text: times.join(', ') }) : null),
      h('div', { class: 'actions' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Handout type' },
          h('button', { 'aria-pressed': String(r.mode === 'paper'), text: 'Paper', onclick: function () { pick('paper'); } }),
          h('button', { 'aria-pressed': String(r.mode === 'online'), text: 'Online', onclick: function () { pick('online'); } })),
        h('button', { class: 'link-btn', text: 'Preview / Edit', onclick: function () { openEdit(job); } })));
  }

  function actionBar() {
    var n = S.view === 'jobs' ? selectedJobs().length : 0;
    return h('div', { class: 'bar' + (n ? ' show' : '') },
      h('div', { class: 'bar-in' },
        h('span', { class: 'n', text: n + ' selected' }),
        h('button', { class: 'btn', onclick: doDownload }, icon('download'), 'Download'),
        h('button', { class: 'btn', onclick: doPrint }, icon('print'), 'Print'),
        h('button', { class: 'btn primary', onclick: doEmailSally }, icon('mail'), 'Email Sally')));
  }

  // ---------------------------------------------------------------- sheets

  var sheetEl = null;
  function openSheet(title, body, foot) {
    closeSheet();
    sheetEl = h('div', { class: 'sheet-wrap', onclick: function (ev) { if (ev.target === sheetEl) closeSheet(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'btn', text: 'Close', onclick: closeSheet })),
        body, foot));
    document.body.appendChild(sheetEl);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', escClose);
  }
  function closeSheet() {
    if (sheetEl) sheetEl.remove();
    sheetEl = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', escClose);
  }
  function escClose(ev) { if (ev.key === 'Escape') closeSheet(); }

  function field(labelText, input, hint) {
    return h('div', { class: 'field' }, h('label', { text: labelText }), input, hint ? h('div', { class: 'hint', text: hint }) : null);
  }
  function textInput(value, oninput) {
    return h('input', { type: 'text', value: value, oninput: function (ev) { oninput(ev.target.value); } });
  }
  function colorPickers(colors, onchange) {
    var names = [['primary', 'Primary'], ['secondary', 'Secondary'], ['accent', 'Accent']];
    return h('div', { class: 'colors' }, names.map(function (n) {
      return h('label', { class: 'color' }, n[1], h('input', {
        type: 'color', value: colors[n[0]],
        oninput: function (ev) { colors[n[0]] = ev.target.value.toUpperCase(); onchange(); }
      }));
    }));
  }

  /** A preview canvas that redraws (debounced) at screen resolution. */
  function previewer(container, getKindAndData) {
    var canvas = h('canvas');
    var cap = h('div', { class: 'cap' });
    container.appendChild(canvas);
    container.appendChild(cap);
    var timer = null, seq = 0;
    function draw() {
      var mine = ++seq;
      getKindAndData().then(function (kd) {
        if (mine !== seq) return;
        return HBR.ensureFonts().then(function () {
          var w = Math.max(container.clientWidth - 24, 240);
          var dpr = Math.min(window.devicePixelRatio || 1, 2);
          var c = HBR.render(kd.kind, kd.data, 72 * w * dpr / HBR.SIZES[kd.kind][0]);
          canvas.width = c.width; canvas.height = c.height;
          canvas.getContext('2d').drawImage(c, 0, 0);
          cap.textContent = kd.caption || '';
        });
      }).catch(function (e) { cap.textContent = e.message; });
    }
    return function (now) { clearTimeout(timer); if (now) draw(); else timer = setTimeout(draw, 120); };
  }

  /** Reads a picked image as a PNG data URL no bigger than maxPx. */
  function readImageFile(file, maxPx) {
    return new Promise(function (resolve, reject) {
      if (!/^image\/(png|jpeg|svg\+xml|webp|gif)$/.test(file.type)) return reject(new Error('Pick a PNG, JPG or SVG file.'));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read the file.')); };
      fr.onload = function () {
        HBR.loadImage(fr.result).then(function (img) {
          var w = img.naturalWidth || img.width || 1000, hgt = img.naturalHeight || img.height || 1000;
          var r = file.type === 'image/svg+xml' ? maxPx / Math.max(w, hgt) : Math.min(1, maxPx / Math.max(w, hgt));
          var c = document.createElement('canvas');
          c.width = Math.round(w * r); c.height = Math.round(hgt * r);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/png'));
        }, reject);
      };
      fr.readAsDataURL(file);
    });
  }
  function filePicker(accept, onfile) {
    var input = h('input', { type: 'file', accept: accept, style: 'display:none', onchange: function () { if (input.files[0]) onfile(input.files[0]); input.value = ''; } });
    return input;
  }

  // ---------------------------------------------------------------- edit one job

  function openEdit(job) {
    var base = resolve(job, true);
    var draft = resolve(job);
    draft.colors = Object.assign({}, draft.colors);
    var prevBox = h('div', { class: 'preview' });
    var fields = h('div', { class: 'fields' });
    var which = { paper: 'full' };
    var redraw = previewer(prevBox, function () {
      var kind = draft.mode === 'online' ? 'online' : which.paper;
      return drawData(draft).then(function (d) {
        return { kind: kind, data: d, caption: kind === 'half' ? 'Half-sheet file (two copies, cut down the middle)' : kind === 'full' ? 'Full sheet' : 'Online handout (letter page)' };
      });
    });
    function setDraftMode(mode) { draft.mode = mode; build(); redraw(true); }

    function build() {
      fields.textContent = '';
      fields.appendChild(h('div', { class: 'row' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Handout type' },
          h('button', { 'aria-pressed': String(draft.mode === 'paper'), text: 'Paper', onclick: function () { setDraftMode('paper'); } }),
          h('button', { 'aria-pressed': String(draft.mode === 'online'), text: 'Online', onclick: function () { setDraftMode('online'); } })),
        draft.mode === 'paper' ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Preview' },
          h('button', { 'aria-pressed': String(which.paper === 'full'), text: 'Full', onclick: function () { which.paper = 'full'; build(); redraw(true); } }),
          h('button', { 'aria-pressed': String(which.paper === 'half'), text: 'Half', onclick: function () { which.paper = 'half'; build(); redraw(true); } })) : null));
      var bind = function (k) { return textInput(draft[k], function (v) { draft[k] = v; redraw(); }); };
      if (draft.mode === 'paper') {
        fields.appendChild(field('Date line', bind('dateLine')));
        fields.appendChild(field('Second line', bind('takingLine')));
        fields.appendChild(field('School and sport line', bind('titleLine'), 'Shrinks to fit if it\'s long.'));
      } else {
        fields.appendChild(field('School name', bind('oName')));
        fields.appendChild(field('School type', bind('oType'), 'For example JUNIOR HIGH or MIDDLE SCHOOL. Leave empty to hide.'));
        fields.appendChild(field('Sport', bind('oSport')));
        fields.appendChild(field('Date', bind('oDate')));
        fields.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Colors' }), colorPickers(draft.colors, redraw)));
        fields.appendChild(h('label', { class: 'check' }, h('input', {
          type: 'checkbox', checked: !draft.noLogo, disabled: !draft.profile.logo,
          onchange: function (ev) { draft.noLogo = !ev.target.checked; redraw(true); }
        }), draft.profile.logo ? 'Show the school logo' : 'No logo for this school yet (add one on the Schools tab)'));
      }
      fields.appendChild(h('div', { class: 'details' },
        h('div', {}, h('b', { text: 'From the calendar' })),
        job.sessions.map(function (s) {
          return h('div', { text: (s.start ? fmtTime(s.start) + (s.end ? '–' + fmtTime(s.end) : '') + '  ' : '') + s.title });
        }),
        job.originals.length ? h('div', { text: 'Note: ' + job.originals.join(' / ') }) : null,
        job.fullName ? h('div', { text: job.fullName }) : null,
        job.sportGuessed ? h('div', { class: 'flag', style: 'display:inline-block;margin-top:4px', text: 'No sport on the calendar: guessed from the season' }) : null));
    }

    function save() {
      var edits = {};
      ['dateLine', 'takingLine', 'titleLine', 'oName', 'oType', 'oSport', 'oDate'].forEach(function (k) {
        if (draft[k] !== base[k]) edits[k] = draft[k];
      });
      if (['primary', 'secondary', 'accent'].some(function (k) { return draft.colors[k].toUpperCase() !== String(base.colors[k]).toUpperCase(); })) edits.colors = draft.colors;
      if (draft.noLogo) edits.noLogo = true;
      edits.mode = draft.mode;
      L.edits[job.id] = edits;
      var mine = L.schools[job.key] = L.schools[job.key] || {};
      mine.lastMode = draft.mode;
      saveLocal();
      closeSheet(); render(); toast('Saved');
    }

    function reset() {
      var keep = { mode: draft.mode, profile: draft.profile };
      Object.assign(draft, base, keep, { colors: Object.assign({}, base.colors), noLogo: false });
      build(); redraw(true);
    }

    build();
    var foot = h('div', { class: 'sheet-foot' },
      h('button', { class: 'link-btn left', text: 'Reset to calendar', onclick: reset }),
      job.coachEmail ? h('button', { class: 'btn', onclick: function () { doEmailCoach(job); } }, icon('mail'), 'Email coach') : null,
      h('button', { class: 'btn', text: 'Cancel', onclick: closeSheet }),
      h('button', { class: 'btn primary', text: 'Save', onclick: save }));
    openSheet(label(job) + ' · ' + dayShort(job.date) + ' ' + md(job.date), h('div', { class: 'sheet-body' }, prevBox, fields), foot);
    redraw(true);
  }

  // ---------------------------------------------------------------- schools

  function renderSchools(main) {
    var list = knownSchools();
    main.appendChild(h('p', { class: 'meta', text: 'Schools come from the calendar. Logos and colors are used on Online handouts. Changes you make here are saved on this device.' }));
    if (!list.length) { main.appendChild(h('div', { class: 'empty', text: 'No schools yet.' })); return; }
    main.appendChild(h('div', { class: 'cards' }, list.map(function (p) {
      var thumb = h('img', { class: 'logo-thumb', alt: '' });
      getLogo(p).then(function (img) { if (img) thumb.src = img.src; });
      var c = p.colors || DEFAULT_COLORS;
      return h('button', { class: 'card', onclick: function () { openSchool(p); } }, thumb,
        h('div', {},
          h('div', { class: 't', text: p.name }),
          h('div', { class: 's', text: [p.typeLabel, p.lastMode === 'online' ? 'Online' : 'Paper'].filter(Boolean).join(' · ') }),
          h('div', { class: 'swatches' }, h('i', { style: 'background:' + c.primary }), h('i', { style: 'background:' + c.secondary }), h('i', { style: 'background:' + c.accent }))));
    })));
  }

  function openSchool(p) {
    var key = p.key;
    var draft = {
      name: p.name, typeLabel: p.typeLabel || '', colors: Object.assign({}, p.colors || DEFAULT_COLORS),
      mirrorLogo: !!p.mirrorLogo, lastMode: p.lastMode || 'paper', aliases: (p.aliases || []).join(', '),
      logo: p.logo, newLogo: null, removeLogo: false
    };
    var nextJob = (S.jobs || []).filter(function (j) { return j.key === key; })[0];
    var currentLogo = function () {
      if (draft.removeLogo) return Promise.resolve(null);
      if (draft.newLogo) return HBR.loadImage(draft.newLogo);
      return getLogo(p);
    };
    var prevBox = h('div', { class: 'preview' });
    var redraw = previewer(prevBox, function () {
      return currentLogo().then(function (logo) {
        return {
          kind: 'online', caption: 'Sample online handout',
          data: {
            name: draft.name, type: draft.typeLabel, sport: nextJob ? nextJob.sportLabel : 'Basketball',
            date: shortDate(nextJob ? nextJob.date : S.today), colors: draft.colors, logo: logo, mirrorLogo: draft.mirrorLogo
          }
        };
      });
    });
    var fields = h('div', { class: 'fields' });

    function build() {
      fields.textContent = '';
      fields.appendChild(field('Name on handouts', textInput(draft.name, function (v) { draft.name = v; redraw(); }), 'Short name, like "Arbor Creek" (keeps the text big).'));
      fields.appendChild(field('School type', textInput(draft.typeLabel, function (v) { draft.typeLabel = v; redraw(); }), 'JUNIOR HIGH, MIDDLE SCHOOL… Leave empty to hide.'));
      var thumb = h('img', { class: 'logo-thumb', alt: '' });
      currentLogo().then(function (img) { if (img) thumb.src = img.src; });
      var hasLogo = !draft.removeLogo && (draft.newLogo || p.logo);
      var picker = filePicker('image/png,image/svg+xml,image/jpeg,image/webp', function (file) {
        readImageFile(file, 600).then(function (dataUrl) {
          draft.newLogo = dataUrl; draft.removeLogo = false;
          return HBR.loadImage(dataUrl).then(function (img) {
            var sug = HBR.suggestColors(img);
            if (sug && window.confirm('Use colors from the logo?')) draft.colors = sug;
            build(); redraw(true);
          });
        }).catch(fail);
      });
      fields.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Logo' }),
        h('div', { class: 'row' }, thumb,
          h('button', { class: 'btn', onclick: function () { picker.click(); } }, icon('upload'), hasLogo ? 'Replace' : 'Upload'),
          hasLogo ? h('button', { class: 'btn danger', text: 'Remove', onclick: function () { draft.removeLogo = true; draft.newLogo = null; build(); redraw(true); } }) : null,
          picker),
        h('div', { class: 'hint', text: 'PNG or SVG with a transparent background works best.' }),
        h('label', { class: 'check', style: 'margin-top:6px' }, h('input', { type: 'checkbox', checked: draft.mirrorLogo, onchange: function (ev) { draft.mirrorLogo = ev.target.checked; redraw(true); } }), 'Flip the right-hand logo (for mascots that face one way)')));
      fields.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Colors' }), colorPickers(draft.colors, redraw),
        hasLogo ? h('button', {
          class: 'link-btn', text: 'Suggest colors from the logo', onclick: function () {
            currentLogo().then(function (img) {
              var sug = img && HBR.suggestColors(img);
              if (!sug) return toast('No clear colors in this logo.', true);
              draft.colors = sug; build(); redraw(true);
            }).catch(fail);
          }
        }) : null));
      var modeSel = h('select', { onchange: function (ev) { draft.lastMode = ev.target.value; } },
        h('option', { value: 'paper', text: 'Paper' }), h('option', { value: 'online', text: 'Online' }));
      modeSel.value = draft.lastMode;
      fields.appendChild(field('Default handout', modeSel, 'Updates by itself to whatever was used last.'));
      fields.appendChild(field('Other names on the calendar', textInput(draft.aliases, function (v) { draft.aliases = v; }), 'Comma separated, for example: ACMS, Arbor Creek MS'));
      if (p.fullName || p.address) fields.appendChild(h('div', { class: 'details' }, p.fullName ? h('div', { text: p.fullName }) : null, p.address ? h('div', { text: p.address }) : null));
    }

    function save() {
      var mine = L.schools[key] = L.schools[key] || {};
      mine.name = draft.name.trim() || p.name;
      mine.typeLabel = draft.typeLabel.trim();
      mine.colors = draft.colors;
      mine.mirrorLogo = draft.mirrorLogo;
      mine.lastMode = draft.lastMode;
      var oldAliases = (p.aliases || []).join();
      mine.aliases = draft.aliases.split(',').map(function (s) { return s.trim(); }).filter(String);
      if (draft.newLogo) {
        if (!lsSet('hb.logo.' + key, draft.newLogo)) return toast('Not enough room on this device to save the logo.', true);
        delete S.images[draft.newLogo];
        mine.logoLocal = true; delete mine.logoRemoved;
      } else if (draft.removeLogo) {
        lsSet('hb.logo.' + key, null);
        delete mine.logoLocal; mine.logoRemoved = true;
      }
      saveLocal();
      closeSheet();
      toast('Saved on this device');
      if (mine.aliases.join() !== oldAliases) loadJobs(); else render();
    }

    build();
    openSheet(p.name, h('div', { class: 'sheet-body' }, prevBox, fields), h('div', { class: 'sheet-foot' },
      L.schools[key] ? h('button', {
        class: 'link-btn left', text: 'Undo my changes to this school', onclick: function () {
          if (!window.confirm('Go back to the shared settings for ' + p.name + '?')) return;
          delete L.schools[key]; lsSet('hb.logo.' + key, null); saveLocal(); closeSheet(); render();
        }
      }) : null,
      h('button', { class: 'btn', text: 'Cancel', onclick: closeSheet }),
      h('button', { class: 'btn primary', text: 'Save', onclick: save })));
    redraw(true);
  }

  // ---------------------------------------------------------------- settings

  function renderSettings(main) {
    var s = { sallyEmail: setting('sallyEmail'), rotateHalfRight: !!setting('rotateHalfRight'), weeks: setting('weeks') };
    main.appendChild(h('div', { class: 'panel' }, h('h2', { text: 'Calendar' }),
      h('div', { class: 'fields' },
        h('div', { class: 'hint', text: calendarLink() ? 'A calendar link is saved on this device.' : 'No calendar link on this device yet.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn', text: calendarLink() ? 'Change calendar link' : 'Add calendar link', onclick: function () { S.view = 'setup'; render(); } }),
          calendarLink() ? h('button', {
            class: 'btn danger', text: 'Remove from this device', onclick: function () {
              if (!window.confirm('Remove the calendar link from this device?')) return;
              lsSet('hb.calendar', null); S.jobs = null; S.view = 'setup'; render();
            }
          }) : null))));
    main.appendChild(h('div', { class: 'panel' }, h('h2', { text: 'Handouts and email' }),
      h('div', { class: 'fields' },
        field('"Email Sally" goes to', h('input', { type: 'email', value: s.sallyEmail, oninput: function (ev) { s.sallyEmail = ev.target.value.trim(); } })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.rotateHalfRight, onchange: function (ev) { s.rotateHalfRight = ev.target.checked; } }), 'Half sheets: turn the right-hand copy upside down'),
        field('Weeks to show', h('input', { type: 'text', inputmode: 'numeric', value: String(s.weeks), oninput: function (ev) { s.weeks = ev.target.value; } })),
        h('div', { class: 'hint', text: 'These are saved on this device.' }),
        h('div', {}, h('button', {
          class: 'btn primary', text: 'Save', onclick: function () {
            if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s.sallyEmail)) return toast('Check the email address.', true);
            L.settings.sallyEmail = s.sallyEmail;
            L.settings.rotateHalfRight = s.rotateHalfRight;
            L.settings.weeks = Math.max(1, Math.min(8, Number(s.weeks) || CFG.weeks));
            saveLocal(); toast('Saved'); S.view = 'jobs'; loadJobs();
          }
        })))));
  }

  // ---------------------------------------------------------------- start

  window.addEventListener('afterprint', function () {
    var root = document.getElementById('print-root');
    Array.prototype.forEach.call(root.querySelectorAll('img'), function (img) { URL.revokeObjectURL(img.src); });
    root.textContent = '';
  });

  HBR.ensureFonts();
  loadJobs();
})();
