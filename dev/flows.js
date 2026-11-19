// End-to-end checks in Chromium against the local server.
//   node dev/server.js &  node dev/flows.js
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const OUT = path.join(__dirname, 'out');
const URL = 'http://localhost:8790/';
const LINK = 'https://calendar.google.com/calendar/ical/test%40example.com/private-0123abcd/basic.ics';
fs.mkdirSync(OUT, { recursive: true });

function listZip(buf) {
  const out = [];
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26);
    out.push({ name: buf.slice(i + 30, i + 30 + nlen).toString(), data: buf.slice(i + 30 + nlen, i + 30 + nlen + size) });
    i += 30 + nlen + size;
  }
  return out;
}
function jpegInfo(b) {
  const dpi = b[13] === 1 ? b.readUInt16BE(14) : null;
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker >= 0xC0 && marker <= 0xC2) return { dpi, h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { dpi };
}

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({ proxy });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('dialog', (d) => d.accept());

  // First visit: setup screen; a wrong link is refused.
  await page.goto(URL);
  await page.waitForSelector('#cal');
  await page.screenshot({ path: path.join(OUT, 'setup.png') });
  await page.fill('#cal', 'https://example.com/cal.ics');
  await page.click('button[type=submit]');
  await page.waitForSelector('.error:has-text("doesn\'t look like")');
  await page.fill('#cal', LINK.replace('https://', 'webcal://'));
  await page.click('button[type=submit]');
  await page.waitForSelector('.job');
  console.log('✓ calendar link saved, jobs:', (await page.$$eval('.job .school', (e) => e.map((x) => x.textContent))).join(', '));
  await page.reload();
  await page.waitForSelector('.job');
  console.log('✓ remembered after reload');
  await page.evaluate(() => HBR.ensureFonts());

  // Edit Cheek; switch Ryan to Online.
  await page.locator('.job', { hasText: 'Ryan' }).locator('.seg button:has-text("Online")').click();
  await page.locator('.job', { hasText: 'Cheek' }).locator('.link-btn').click();
  await page.fill('.sheet .field:has-text("School and sport line") input', 'Cheek Middle School Boys Basketball Photos');
  await page.click('.sheet .btn.primary:has-text("Save")');
  await page.waitForSelector('.job:has-text("Cheek") .edited');
  console.log('✓ edit saved');

  // Download this week's jobs.
  await page.locator('.week-head input').first().check();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.bar .btn:has-text("Download")')]);
  const zipPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(zipPath);
  const entries = listZip(fs.readFileSync(zipPath));
  console.log('zip:', dl.suggestedFilename(), entries.map((e) => e.name + ' ' + JSON.stringify(jpegInfo(e.data))).join(' | '));
  assert.equal(entries.length, 3);
  entries.forEach((e) => assert.equal(jpegInfo(e.data).dpi, 300));
  console.log('✓ download');

  // Print
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('.bar .btn:has-text("Print")');
  await page.waitForFunction(() => window.__printed === 1);
  assert.deepEqual(await page.$$eval('#print-root .pg', (els) => els.map((e) => e.className)), ['pg', 'pg land', 'pg']);
  console.log('✓ print');

  // Email Sally: sheet with a mailto link (subject Handouts) that also downloads the files.
  await page.click('.bar .btn:has-text("Email Sally")');
  await page.waitForSelector('.sheet a:has-text("Open email app")');
  const sallyHref = await page.getAttribute('.sheet a:has-text("Open email app")', 'href');
  console.log('sally mailto:', decodeURIComponent(sallyHref).replace(/\n/g, ' | '));
  assert.ok(sallyHref.startsWith('mailto:office@sloanphotography.com?subject=Handouts&body='));
  await page.screenshot({ path: path.join(OUT, 'email-sally.png') });
  await page.evaluate(() => { document.querySelector('.sheet a[href^="mailto:"]').addEventListener('click', (e) => e.preventDefault()); });
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('.sheet a:has-text("Open email app")')]);
  console.log('✓ email Sally (download with it:', dl2.suggestedFilename() + ')');
  await page.click('.sheet .btn:has-text("Done")');

  // Email coach from Cheek.
  await page.locator('.job', { hasText: 'Cheek' }).locator('.link-btn').click();
  await page.click('.sheet .btn:has-text("Email coach")');
  await page.waitForSelector('.sheet a:has-text("Open email app")');
  const coachHref = await page.getAttribute('.sheet a:has-text("Open email app")', 'href');
  assert.ok(coachHref.startsWith('mailto:ctreiber@example.org?subject=Picture%20day'));
  console.log('✓ email coach');
  await page.click('.sheet .btn:has-text("Done")');

  // Download from the preview, with an unsaved edit: the file uses what's on screen.
  await page.locator('.job', { hasText: 'Arbor Creek' }).locator('.link-btn').click();
  await page.fill('.sheet .field:has-text("Date line") input', 'Tuesday November 24 (unsaved test)');
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('.sheet .btn:has-text("Download")')]);
  const z3 = listZip(fs.readFileSync(await dl3.path()));
  console.log('preview download:', dl3.suggestedFilename(), z3.map((e) => e.name).join(', '));
  assert.equal(z3.length, 2);
  await page.click('.sheet .btn:has-text("Cancel")');
  assert.equal(await page.locator('.job:has-text("Arbor Creek") .edited').count(), 0);
  console.log('✓ download from preview (edit not saved)');

  // Not a school: remove Gunn, its job disappears; put it back.
  await page.click('.tab:has-text("Schools")');
  await page.click('.card:has-text("Gunn")');
  await page.click('.sheet .btn:has-text("Not a school")');
  await page.waitForSelector('.panel:has-text("Removed (not schools)") >> text=Gunn');
  assert.equal(await page.locator('.card:has-text("Gunn")').count(), 0);
  await page.click('.tab:has-text("Jobs")');
  assert.equal(await page.locator('.job:has-text("Gunn")').count(), 0);
  await page.reload();
  await page.waitForSelector('.job');
  assert.equal(await page.locator('.job:has-text("Gunn")').count(), 0);
  await page.click('.tab:has-text("Schools")');
  await page.screenshot({ path: path.join(OUT, 'schools-removed.png'), fullPage: true });
  await page.click('.panel:has-text("Removed") button:has-text("Put back")');
  await page.click('.tab:has-text("Jobs")');
  await page.waitForSelector('.job:has-text("Gunn")');
  console.log('✓ not-a-school removes the jobs and can be put back');

  // School: upload a logo, alias, saved on this device and kept after reload.
  await page.click('.tab:has-text("Schools")');
  await page.click('.card:has-text("Ryan")');
  const logo = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#5B2C83'; x.beginPath(); x.arc(150, 150, 140, 0, 7); x.fill();
    x.fillStyle = '#F2B705'; x.font = 'bold 170px Arial'; x.textAlign = 'center'; x.fillText('R', 150, 210);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, 'test-logo.png'), Buffer.from(logo.split(',')[1], 'base64'));
  await page.setInputFiles('.sheet input[type=file]', path.join(OUT, 'test-logo.png'));
  await page.waitForSelector('.sheet .btn:has-text("Replace")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'school-edit.png') });
  await page.click('.sheet .btn.primary:has-text("Save")');
  await page.reload();
  await page.waitForSelector('.job');
  await page.click('.tab:has-text("Schools")');
  await page.waitForFunction(() => [...document.querySelectorAll('.card')].some((c) => c.textContent.includes('Ryan') && c.querySelector('img').src.startsWith('data:')));
  console.log('✓ school logo kept on this device');

  // Settings
  await page.click('.tab:has-text("Settings")');
  await page.screenshot({ path: path.join(OUT, 'settings.png'), fullPage: true });

  // Phone
  const phone = await browser.newContext(Object.assign({}, devices['iPhone 13']));
  const p2 = await phone.newPage();
  p2.on('pageerror', (e) => console.log('pageerror (phone):', e.message));
  await p2.goto(URL);
  await p2.fill('#cal', LINK);
  await p2.click('button[type=submit]');
  await p2.waitForSelector('.job');
  await p2.click('.week-head input[type=checkbox]');
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: path.join(OUT, 'jobs-phone.png') });

  await browser.close();
  console.log('ALL FLOWS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
