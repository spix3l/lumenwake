import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDirectory = process.env.SCREENSHOT_DIRECTORY ?? '/var/folders/_2/pq00_xc91lx87rb2vl9hwf0w0000gn/T/opencode';
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const consoleErrors = [];
const results = {};

function trackErrors(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`));
}

const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const desktop = await desktopContext.newPage();
trackErrors(desktop, 'desktop');
await desktop.goto(`${baseUrl}/?qa=1`, { waitUntil: 'networkidle' });
await desktop.waitForFunction(() => window.__LUMENWAKE__?.snapshot().assetsReady === true);
await desktop.locator('#start-screen').waitFor({ state: 'visible' });
await desktop.screenshot({ path: `${screenshotDirectory}/lumenwake-desktop-start.png` });
await desktop.locator('#start-button').click();
await desktop.waitForFunction(() => window.__LUMENWAKE__?.snapshot().mode === 'running');
await desktop.waitForFunction(() => window.__LUMENWAKE__?.snapshot().mode === 'upgrade', null, { timeout: 15000 });
const levelState = await desktop.evaluate(() => window.__LUMENWAKE__?.snapshot());
assert.ok(levelState && levelState.level >= 2, 'XP should trigger an upgrade');
assert.ok((await desktop.locator('.upgrade-card').count()) === 3, 'Upgrade screen should show three choices');
for (let choice = 0; choice < 3; choice += 1) {
  if (await desktop.evaluate(() => window.__LUMENWAKE__?.snapshot().mode !== 'upgrade')) break;
  await desktop.locator('.upgrade-card').first().click();
  await desktop.waitForTimeout(80);
}
await desktop.waitForFunction(() => window.__LUMENWAKE__?.snapshot().mode === 'running');
await desktop.keyboard.down('KeyD');
await desktop.waitForTimeout(1600);
await desktop.keyboard.up('KeyD');
const movementState = await desktop.evaluate(() => window.__LUMENWAKE__?.snapshot());
assert.ok(movementState && movementState.playerX > 800, 'Player should move through the open terrain');
for (let choice = 0; choice < 3; choice += 1) {
  if (await desktop.evaluate(() => window.__LUMENWAKE__?.snapshot().mode !== 'upgrade')) break;
  await desktop.locator('.upgrade-card').first().click();
  await desktop.waitForTimeout(80);
}
const combatState = await desktop.evaluate(() => window.__LUMENWAKE__?.snapshot());
assert.ok(combatState && (combatState.enemies > 0 || combatState.kills > 0), 'Enemies should spawn and be defeated');
await desktop.locator('#pause-button').click();
assert.equal(await desktop.evaluate(() => window.__LUMENWAKE__?.snapshot().mode), 'paused');
await desktop.locator('#resume-button').click();
assert.equal(await desktop.evaluate(() => window.__LUMENWAKE__?.snapshot().mode), 'running');
await desktop.evaluate(() => window.__LUMENWAKE__?.debugVictory());
await desktop.locator('#end-screen').waitFor({ state: 'visible' });
assert.equal(await desktop.locator('#end-title').textContent(), 'Dawn secured');
await desktop.screenshot({ path: `${screenshotDirectory}/lumenwake-desktop-victory.png` });
await desktop.locator('#restart-button').click();
await desktop.waitForFunction(() => window.__LUMENWAKE__?.snapshot().mode === 'running');
await desktop.evaluate(() => window.__LUMENWAKE__?.debugDefeat());
await desktop.locator('#end-screen').waitFor({ state: 'visible' });
assert.equal(await desktop.locator('#end-title').textContent(), 'The dark prevailed');
await desktop.locator('#restart-button').click();
await desktop.waitForFunction(() => window.__LUMENWAKE__?.snapshot().mode === 'running');
results.desktop = combatState;

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const mobile = await mobileContext.newPage();
trackErrors(mobile, 'mobile');
await mobile.goto(`${baseUrl}/?qa=1`, { waitUntil: 'networkidle' });
await mobile.locator('#start-button').click();
await mobile.waitForFunction(() => window.__LUMENWAKE__?.snapshot().mode === 'running');
await mobile.dispatchEvent('#game-canvas', 'pointerdown', { pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: 220, clientY: 590, buttons: 1 });
assert.equal(await mobile.locator('#joystick').getAttribute('class'), 'is-active');
await mobile.dispatchEvent('#game-canvas', 'pointermove', { pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: 262, clientY: 548, buttons: 1 });
await mobile.waitForTimeout(700);
await mobile.dispatchEvent('#game-canvas', 'pointerup', { pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: 262, clientY: 548 });
assert.equal(await mobile.locator('body').getAttribute('class'), 'touch-mode');
const viewportFits = await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight);
assert.equal(viewportFits, true, 'Mobile layout should not scroll');
await mobile.screenshot({ path: `${screenshotDirectory}/lumenwake-mobile-gameplay.png` });
results.mobile = await mobile.evaluate(() => window.__LUMENWAKE__?.snapshot());

const compactContext = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const compact = await compactContext.newPage();
trackErrors(compact, 'compact');
await compact.goto(baseUrl, { waitUntil: 'networkidle' });
await compact.locator('#start-screen').waitFor({ state: 'visible' });
const titleFits = await compact.locator('h1').evaluate((node) => node.scrollWidth <= node.clientWidth);
assert.equal(titleFits, true, 'Compact title should fit its panel');
await compact.screenshot({ path: `${screenshotDirectory}/lumenwake-compact-start.png` });
await compactContext.close();

const landscapeContext = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const landscape = await landscapeContext.newPage();
trackErrors(landscape, 'landscape');
await landscape.goto(`${baseUrl}/?qa=1`, { waitUntil: 'networkidle' });
await landscape.locator('#start-button').click();
await landscape.waitForFunction(() => window.__LUMENWAKE__?.snapshot().mode === 'running');
const landscapeFits = await landscape.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight);
assert.equal(landscapeFits, true, 'Landscape gameplay should not scroll');
await landscape.screenshot({ path: `${screenshotDirectory}/lumenwake-landscape-gameplay.png` });
results.landscape = await landscape.evaluate(() => window.__LUMENWAKE__?.snapshot());
await landscapeContext.close();

const manifest = await mobile.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  const response = await fetch(link.getAttribute('href'));
  return response.json();
});
assert.equal(manifest.name, 'Lumenwake');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons.length >= 3);
const cdp = await mobileContext.newCDPSession(mobile);
const appManifest = await cdp.send('Page.getAppManifest');
const installability = await cdp.send('Page.getInstallabilityErrors');
assert.deepEqual(appManifest.errors, []);
assert.deepEqual(installability.installabilityErrors.filter((item) => item.errorId !== 'in-incognito'), []);
results.installability = installability.installabilityErrors;
await mobile.evaluate(() => navigator.serviceWorker.ready);
const registrations = await mobile.evaluate(async () => {
  const items = await navigator.serviceWorker.getRegistrations();
  return items.map((item) => ({ scope: item.scope, active: Boolean(item.active) }));
});
assert.ok(registrations.some((item) => item.active), 'Service worker should be active');
results.serviceWorker = registrations;
await mobileContext.setOffline(true);
await mobile.reload({ waitUntil: 'domcontentloaded' });
await mobile.locator('#start-screen').waitFor({ state: 'visible' });
assert.equal(await mobile.title(), 'Lumenwake');
await mobileContext.setOffline(false);

assert.deepEqual(consoleErrors, [], `Console errors found: ${consoleErrors.join('\n')}`);
await browser.close();
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
