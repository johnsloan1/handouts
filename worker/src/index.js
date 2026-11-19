/**
 * Calendar relay for Foxtrot Handouts.
 *
 * Browsers aren't allowed to read Google Calendar feeds directly, so the page
 * asks this Worker to fetch one for it: GET /?url=<Google iCal link>.
 * It only fetches Google Calendar iCal links, stores nothing and logs no links.
 */
const ALLOWED_ORIGINS = [
  'https://handouts.foxtrotphoto.com',
  'https://johnsloan1.github.io',
  'http://localhost:8790'
];
const ICS_PATH = /^\/calendar\/ical\/[^/]+\/(private-[0-9a-f]+|public)\/basic\.ics$/;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET') return new Response('Use GET', { status: 405, headers: cors });

    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get('url') || '');
    } catch (e) {
      return new Response('Add ?url= with a Google Calendar iCal link.', { status: 400, headers: cors });
    }
    if (target.protocol !== 'https:' || target.hostname !== 'calendar.google.com' || !ICS_PATH.test(target.pathname)) {
      return new Response('Only Google Calendar iCal links can be fetched.', { status: 400, headers: cors });
    }
    const res = await fetch(target.toString(), { headers: { 'User-Agent': 'Foxtrot-Handouts-Relay' }, cf: { cacheTtl: 0 } });
    if (!res.ok) {
      return new Response('Google Calendar answered ' + res.status + '. Check the calendar link.', { status: 502, headers: cors });
    }
    return new Response(res.body, { headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8' } });
  }
};
