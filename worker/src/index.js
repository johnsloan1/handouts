/**
 * Calendar relay for Foxtrot Handouts.
 *
 * Browsers aren't allowed to read Google Calendar feeds directly, so the page
 * asks this Worker to fetch one for it: POST / with the Google iCal link as
 * the plain-text body. The link goes in the body, not the address, so it never
 * shows up in Cloudflare's request logs. Only Google Calendar iCal links are
 * fetched, and nothing is stored.
 *
 * Only the handouts page may use it: handouts.foxtrotphoto.com, over http or
 * https. Other sites get no answer their browser will accept.
 */
const SITE = 'handouts.foxtrotphoto.com';

function allowedOrigin(origin) {
  try { return new URL(origin).hostname === SITE; } catch (e) { return false; }
}
const ICS_PATH = /^\/calendar\/ical\/[^/]+\/(private-[0-9a-f]+|public)\/basic\.ics$/;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const ok = allowedOrigin(origin);
    const cors = { 'Vary': 'Origin', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    if (ok) cors['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'POST') return new Response('Foxtrot Handouts calendar relay.', { headers: cors });
    if (!ok) return new Response('This relay only works for ' + SITE + '.', { status: 403, headers: cors });

    let target;
    try {
      target = new URL((await request.text()).trim().slice(0, 500));
    } catch (e) {
      return new Response('Send a Google Calendar iCal link.', { status: 400, headers: cors });
    }
    if (target.protocol !== 'https:' || target.hostname !== 'calendar.google.com' || !ICS_PATH.test(target.pathname)) {
      return new Response('Only Google Calendar iCal links can be fetched.', { status: 400, headers: cors });
    }
    let res;
    try {
      res = await fetch(target.toString(), { headers: { 'User-Agent': 'Foxtrot-Handouts-Relay' } });
    } catch (e) {
      return new Response('Could not reach Google Calendar from the relay. Try again in a minute.', { status: 502, headers: cors });
    }
    if (!res.ok) {
      const why = res.status === 404 ? 'Google doesn\'t know that calendar link. Copy the secret address again.' : 'Google Calendar answered ' + res.status + '.';
      return new Response(why, { status: 502, headers: cors });
    }
    return new Response(res.body, { headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8' } });
  }
};
