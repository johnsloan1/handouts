# Foxtrot Handouts

Makes the picture-day handouts for John's school sports jobs, at
<https://handouts.foxtrotphoto.com>. It reads the **Houses - Foxtrot** Google
Calendar, finds the school jobs in the next four weeks, and makes **Paper**
handouts (full sheet + half sheet, with prices) or **Online** handouts (school
colors and logo, no prices) as 300 dpi JPEGs. From the job list you can
**Download**, **Print**, or **Email Sally**.

It's a plain web page, like Pinpoint: pushing to `main` publishes it. Nothing
in it is secret, and it never holds a Google login.

## How it works

- **Calendar:** each person pastes the calendar's *Secret address in iCal
  format* once per device (Google Calendar → the calendar's ⋮ → Settings and
  sharing). It is saved only in that browser. Browsers can't read Google
  calendar feeds directly, so the page asks a tiny relay to fetch it
  (`worker/`, a Cloudflare Worker). The relay only fetches Google Calendar
  iCal links and stores nothing.
- **Email:** *Email Sally* and *Email coach* open your own email app with the
  address and subject filled in (Sally's subject: **Handouts**). On iPhone,
  iPad and Mac Safari, **Share to Mail** attaches the handouts for you;
  otherwise they download and you attach them.
- **Schools:** shared settings for everyone live in `data/schools.json`, with
  logos in `logos/`. Changes made on the Schools tab are saved on that device
  only. To share a logo or colors with everyone, add them to
  `data/schools.json`:
  ```json
  {
    "arbor creek": {
      "name": "Arbor Creek",
      "typeLabel": "MIDDLE SCHOOL",
      "colors": { "primary": "#B3121F", "secondary": "#0B2A5B", "accent": "#B3121F" },
      "logo": "logos/arbor-creek.png",
      "mirrorLogo": false,
      "aliases": ["ACMS"]
    }
  }
  ```
  The key is the school name from the calendar title in lower case.
  To hide something that isn't a school for everyone, add `"hidden": true` to
  its entry. On one device, use **Not a school — remove** on the Schools tab.
- **Preview / Edit** has a **Download** button that saves that job's handout as
  it looks on screen, edits included, even before you save them.
- **Edits** to one job, the Paper/Online choice, Sally's address and the
  half-sheet setting are saved on the device where they're made.
- **Saved on a device** means in that browser. On iPhone, add the page to the
  Home Screen (Share → Add to Home Screen) so it stays saved.

## How jobs are read from the calendar

- School jobs look like `School – Sport`, sometimes ending in `(AM)` / `(PM)`,
  with the school name and address in Location.
- Skipped: `Travel → …`, `Set up – …`, `Between … sessions`, anything starting
  `TENTATIVE`, house shoots (title starts with a street number, or an
  `agent.foxtrotphoto.com` link), and `New Event` or other titles without
  `School – …`. Repeating events only count on their first date.
- Every block for the same school on the same day becomes **one handout**:
  AM and PM, boys and girls, 7th and 8th grade.
- Sport comes from the title, then from Sally's `Original entry: "…"` note.
  Abbreviations: VB, FB, BBB, GBB, bsk, XC/CC, plus plain words. With no sport
  written, it uses the season (Aug–Oct Football/Volleyball, Nov–Jan
  Basketball, Feb Baseball/Softball, Mar–Apr Soccer) and shows
  **sport guessed**.
- "Boys"/"Girls" is shown only when the whole day is one gender. Grades are
  never shown.

## The handouts

| Type | File | Size |
| --- | --- | --- |
| Paper | `YYYY-MM-DD School Sport - Paper Full.jpg` | 8.5×11 portrait, 2550×3300 px |
| | `YYYY-MM-DD School Sport - Paper Half.jpg` | 11×8.5 landscape, two copies, 3300×2550 px |
| Online | `YYYY-MM-DD School Sport - Online.jpg` | 8.5×11 portrait, 2550×3300 px |

Paper handouts place the three text lines and the price image
(`assets/paper-body.png`) where they are in the sample PDFs (`docs/samples/`).
The text uses Arimo, a free font with Helvetica's letter widths.

## Hosting

- **Page:** GitHub Pages from `main` (root), with `CNAME` =
  `handouts.foxtrotphoto.com`.
- **Relay:** Cloudflare Workers, connected to this repo with root directory
  `worker`; Cloudflare redeploys it on every push. Its address goes in
  `relayUrl` in `js/config.js`. Pages allowed to use it are listed at the top
  of `worker/src/index.js`.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `css/app.css`, `js/app.js` | The page |
| `js/config.js` | Relay address, Sally's email, weeks shown |
| `js/ics.js` | Reads the calendar feed |
| `js/parse.js` | Turns calendar events into jobs |
| `js/render.js` | Draws the handouts |
| `js/zip.js` | Makes .zip downloads |
| `data/schools.json`, `logos/` | Shared school settings |
| `worker/` | Calendar relay (Cloudflare Worker) |
| `test/`, `dev/` | Tests and a local test server |
| `docs/` | Original spec and sample handouts |

## Testing on a computer

```
npm test               # calendar reading and job parsing
node dev/server.js     # local copy at http://localhost:8790 with made-up jobs
node dev/flows.js      # end-to-end check in Chromium (needs Playwright)
```
On the local copy, paste any Google iCal-style link, e.g.
`https://calendar.google.com/calendar/ical/test%40example.com/private-0123abcd/basic.ics`.
