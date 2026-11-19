# Foxtrot Photo — Handout Builder (build spec)

A small private web app, hosted on John's website, that reads upcoming school sports jobs from John's Google Calendar and produces the picture-day handouts that Sally sends to coaches and prints.

Users: **John Sloan** (owner) and **Sally** (his mom, office@sloanphotography.com). Sally is not tech-savvy: she must be able to open a bookmarked link on John's site, sign in simply, and get handouts. She must never have to connect accounts, install anything, or use Claude.

This will later become a module of John's planned GotPhoto-replacement platform (custom volume photography site). Keep the handout renderer and school profiles as clean, reusable pieces.

---

## 1. Where the jobs come from

**Source calendar:** Google Calendar "Houses - Foxtrot"
`e79f4fa183032d0578c88b880384a644d9b8c0d18ebced3bc32f0bbc7054d6dd@group.calendar.google.com` (time zone America/Chicago), owned by john@foxtrotphoto.com.

This calendar only holds John's own jobs (Sally's jobs live on a different calendar and are **out of scope**; she doesn't need handouts for hers right now).

Access it server-side with John's Google account (OAuth once by John, refresh token stored on the server, or a service account the calendar is shared with). Sally never authenticates with Google.

**Window:** today through the next 4 weeks, grouped by week (Mon–Sun).

### Which events are school jobs
School job blocks are titled `School – Sport` with an optional ` (AM)` / ` (PM)` suffix and have the school's full name + address in Location. Real examples:

- `Cheek – Boys Basketball (AM)` / `Cheek – Boys Basketball (PM)`
- `Ryan – Girls & Boys Basketball (AM)`
- `Arbor Creek – Girls Basketball`
- `Bailey – 7th Girls & Boys Basketball`, `Bailey – 8th Girls Basketball`, `Bailey – 8th Boys Basketball` (same day)
- `Shadow Ridge – All Boys`, `McKamy – Boys (AM)`, `Marine Creek – All Boys` (no sport written)
- `Gunn – Boys Basketball`

**Skip:**
- `Travel → …`, `Set up – …`, `Between … sessions …`
- anything starting `TENTATIVE` (John: possible jobs don't get handouts)
- house shoots (title starts with a street address, description has an `agent.foxtrotphoto.com` link)
- `New Event` and any other untitled or personal items

The description often contains `Original entry: "…"` with Sally's raw note (e.g. `"Cheek BBB. Corey Treiber"`). Use it as a fallback for sport detection.

### Merging (one handout per school per day)
All job blocks for the **same school on the same date** become **one handout**: AM and PM sessions, boys and girls, 7th and 8th grade.
- Separate handouts only if they fall on different days.
- Gender wording: if the merged group is only boys or only girls, the sport line may include it (John's own example: "…Central Middle School boys basketball photos"). If it mixes boys and girls, or says "all" / "b and g" / "G & B", drop gender and just say the sport ("Basketball"). Grades are never shown.

### Sport detection
1. Read the sport from the title, else from the `Original entry` text. Abbreviations used on the calendars:
   - `VB` volleyball · `FB` football · `BBB` boys basketball · `GBB` girls basketball · `bsk` / `Bsk` basketball · `XC` / `CC` cross country · plus plain words (soccer, track, baseball, softball, tennis)
   - matching is case-insensitive
2. If no sport is written, use the Texas middle-school season default from the job date:
   - Aug–Oct → Football (also Volleyball / Cross Country; pick Football for boys, Volleyball for girls)
   - Nov–Jan → Basketball
   - Feb → Baseball / Softball (Baseball for boys, Softball for girls)
   - Mar–Apr → Soccer (sometimes Track)
   - other months → leave blank
3. Show a visible "sport guessed" flag on the job row whenever the season default was used, so John or Sally can glance at it.

### School name
Use the short name from the title ("Arbor Creek", "Cheek", "Creek Valley"), **not** "Middle School" / "Junior High", so the text stays big. This is editable per school in the school profile (e.g. "ACMS" might need expanding if a title ever uses it).

---

## 2. Main screen (job list)

Must work well on an iPhone and on a computer.

- Jobs listed by week for the next 4 weeks.
- **Master checkbox per week** (select all that week).
- Per job:
  - checkbox
  - date
  - school
  - sport, with the guessed flag when it applies
  - **Paper / Online toggle**, defaulting to whatever that school used last time and saved per school. New schools default to Paper.
  - Preview / Edit button
- Actions on the selected jobs:
  - **Download** (JPEG files, zipped when there is more than one)
  - **Print** (opens a print view with all selected handouts, one per page)
  - **Email to Sally** (office@sloanphotography.com)
- A refresh button to re-read the calendar. Also refresh automatically on load.
- Pinned for later (build the hook, hide the button): "Email to coach", using the coach email found in the event description (`Contact: … · email`). John is asking Sally whether she'd use it.

### Edit
Opening a handout lets the user edit every changeable line before output:
- date line
- "we will be taking"
- "[School] [Sport] Photos" line
- for online: school name, sport, date, colors and logo

Edits apply to that job only and are saved with it. A "reset to calendar" link undoes them.

---

## 3. Handout templates

### 3a. Paper handout (has prices and payment info)
Match the samples in `assets/samples/` exactly.

**Full sheet:** letter portrait, 8.5×11 (see `paper-full-ArborCreek-Football.pdf`).
- The whole price/payment block, the Foxtrot logo, the no-sandals icon and the email address are one image: `assets/paper-body.png` (1547×1933 px). In the original it is placed at x=27pt, y=42pt, size ≈553×691pt on the 612×792pt page.
- Only these three live text lines change. They sit centered in the white area at the top. Positions are from the sample PDF, in points from the top-left:
  1. `Thursday October 15`: Helvetica Neue Bold Italic, ≈40pt, centered, top ≈62pt
  2. `we will be taking`: Helvetica Neue regular, ≈23pt, centered, top ≈111pt
  3. `Arbor Creek Football Photos`: Helvetica Neue Bold, ≈36pt, centered, top ≈140pt. **Auto-shrink** to fit the width for long names.
- Date format: `Weekday Month D` (no year, no comma), e.g. `Wednesday December 3`.
- Prices are the same for every school and are baked into the image. If prices ever change, swap the image, or (nice to have) rebuild the price block as editable text in settings.

**Half-sheet file:** letter landscape, 11×8.5 (see `paper-half-CreekValley-Football.pdf`).
- Two identical copies side by side, each 5.5×8.5 portrait, cut vertically down the middle.
- John described them as "each flipped". Check this against the sample PDF: in the sample both copies are upright. Match the sample, and keep a setting to rotate the right-hand copy 180° in case that's what he means.

**A paper job outputs two files:** the full sheet and the half sheet.

### 3b. Online handout (picture-day notice, no prices)
Style reference: `assets/samples/online-style-reference-Bedford.png`. Layout from top to bottom:
1. school logo at the left and right of the school name
2. school name, big, in primary color
3. school type below it ("JUNIOR HIGH" / "MIDDLE SCHOOL"), smaller, in secondary color
4. rule
5. sport in a solid primary or secondary color band
6. "PICTURE DAY"
7. `WEEKDAY M/D` big, in accent color
8. rule
9. two info panels:
   - no-sandals icon + "NO SANDALS, CROCS, OR FLIPFLOPS"
   - envelope icon + "EMAIL SAMPLES WILL BE SENT DIRECTLY TO PARENTS WITH OPTIONS TO PURCHASE PRINTS OR DIGITAL FILES."
10. two color stripes at the bottom

**An online job outputs one file.** It must be fully printable. **Open question:** the sample is square. Default to a letter-portrait page (8.5×11) that keeps this layout, and add a square variant if John asks.

Do **not** draw or generate school mascots or logos. Logos come only from files John or Sally upload for that school. With no logo, the layout works without one (centered text, no side art).

---

## 4. School profiles

Saved on the server, shared by John and Sally.

- display name (short), school type label, address (from the calendar)
- primary / secondary / accent colors (color pickers). Nice to have: suggest colors by sampling the uploaded logo.
- logo upload (PNG/SVG, transparent preferred)
- last used mode (Paper / Online), updated when a handout is output
- name aliases, so calendar titles map to one school (e.g. "ACMS" → Arbor Creek, "Shack" → Shackelford)

---

## 5. Output details

- **JPEG:** 300 dpi (letter = 2550×3300 px; half-sheet landscape = 3300×2550 px), high quality, so the files print sharply. Render server-side (e.g. headless Chromium or a canvas library) so output is identical on any device.
- **File names:** `YYYY-MM-DD School Sport - Paper Full.jpg`, `… - Paper Half.jpg`, `… - Online.jpg`
- **Email to Sally:**
  - Sent from John's Google account (john@foxtrotphoto.com, to be confirmed) through the Gmail API, or any transactional email service that sends as John.
  - Subject like `Handouts – Arbor Creek Basketball (12/3)` or `Handouts – 3 jobs, week of 12/1`
  - Short body listing each job
  - **Max 5 handouts per email** (a paper handout counts as one even though it is two files). More than 5 selected → split into several emails.
  - Keep the total under about 20MB per email.
- **Print:** one browser print view with every page in order, with correct page sizes (portrait for full and online, landscape for half).
- Log every output (who, when, which jobs, which action) so John can see what was sent.

---

## 6. Hosting and sign-in

- Host on John's website (ask John which host or platform foxtrotphoto.com runs on, and whether to use a subdomain like `handouts.foxtrotphoto.com`).
- Private: only John and Sally can sign in. Make it simple for Sally:
  - either an emailed magic link / one-time code
  - or a password she keeps saved on her device with a long-lived session
- No public access, and no indexing.
- Roles: John is admin (settings, templates, prices image). Sally can do everything on the main screen and edit school profiles.

---

## 7. Assets in this package

- `assets/paper-body.png`: the price/payment body image from the paper handout (includes the Foxtrot logo and no-sandals icon)
- `assets/samples/paper-full-ArborCreek-Football.pdf`: full-sheet sample
- `assets/samples/paper-half-CreekValley-Football.pdf`: half-sheet sample
- `assets/samples/online-style-reference-Bedford.png`: online style reference. Use the **layout** only. Its horse artwork closely resembles a pro-team logo and must not be reused; real school logos come from uploads.

Fonts used in the paper sample: Helvetica Neue (Bold Italic, Regular, Bold). Use Helvetica Neue if it's licensed on the server, otherwise Arial / Helvetica.

---

## 8. Open questions for John
1. Online handout size: letter page, or keep it square?
2. Half-sheet "flipped": the sample shows both copies upright. Same, or rotate one?
3. Email sender: send as john@foxtrotphoto.com?
4. Website host or platform, and the subdomain.
5. Email-to-coach: on hold until Sally decides.
