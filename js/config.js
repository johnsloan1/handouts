/* Settings shared by everyone who opens the page. */
var HB_CONFIG = {
  // The Cloudflare Worker that fetches the calendar (see worker/).
  relayUrl: 'https://handouts.sloanphoto.workers.dev',
  timeZone: 'America/Chicago',
  weeks: 4,
  emailSubject: 'Handouts',
  // Default coach email; each device can change it in Settings.
  // Placeholders: [school] [sport] [day] [date] [short date] [time] [coach]
  coachSubject: 'Picture day – [school] [sport] ([short date])',
  coachBody: 'Hi [coach],\n\nAttached is the picture-day handout for [day] [date].\n\nThank you!\nJohn Sloan\nFoxtrot Photography'
};
