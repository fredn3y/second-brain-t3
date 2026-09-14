// Acceptance of the preserved production bundle, not a reimplementation of the UI.
// Every HTTP/WS request is intercepted; fixtures contain no private host state.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(path.join(process.env.RUNNER_TEMP, 'automation-browser/node_modules/playwright'));
const catalog = require('./automation-browser-catalog.json');
const root = path.join(process.env.RUNNER_TEMP, 'automation-built/client');
const evidence = path.join(process.env.RUNNER_TEMP, 'automation-browser-evidence');
const origin = 'https://app.t3.codes'; // Existing hosted-static mode; all traffic fulfilled locally.
const timestamp = '2026-09-14T08:00:00Z';
const posts = [], blocked = [], checks = [], errors = [];
let apiError = null, modelsError = null, rejectWrite = false;
const route = (consumer, label, model = 'gpt-5.6-sol', effort = 'low') => ({
  consumer, label, description: 'Synthetic acceptance fixture', engine: 'codex', engine_label: 'Codex',
  engines_allowed: ['codex'], default_engine: 'codex', model, effort, default_model: 'gpt-5.6-sol',
  default_effort: 'low', effort_required: true, source: model === 'gpt-6-astra' ? 'override' : 'default',
  updated_at: timestamp, updated_by: 'acceptance fixture',
});
const models = { ok: true, catalog, consumers: [route('daybrief', 'Daybrief', 'gpt-6-astra', 'xhigh'),
  route('drift_scan', 'Drift scan'), route('mail', 'Mail brief'), route('invoices', 'Weekly invoices'),
  route('inventory', 'Inventory'), { ...route('helper', 'Shared helper'), effort_required: false, effort: '' }] };
const job = (id, label, extra = {}) => ({ id, label, description: 'Synthetic recurring task for acceptance testing.',
  consumer: null, kind: null, managed: true, installed: true, enabled: true, active: true, status: 'finished',
  last_start: timestamp, last_finish: timestamp, next_run: '2026-09-15T06:00:00Z', result: 'success',
  schedule: ['Mon..Fri 07:00 Europe/London'], schedule_mode: 'daily', form: { cadence: 'weekdays', time: '07:00' },
  after: [], ordering_installed: true, output_error: false, output: null, current_thread: false, ...extra });
const automations = { ok: true, timezone: 'Europe/London', checked_at: timestamp, jobs: [
  job('drift-scan', 'Drift scan', { consumer: 'drift_scan', status: 'failed', result: '1 of 20 scans failed',
    output: { label: 'Latest report', url: `${origin}/fixture-report`, created_at: timestamp } }),
  job('daybrief', 'Daybrief', { consumer: 'daybrief', kind: 'daybrief', status: 'launched', after: ['drift-scan'], ordering_installed: false }),
  job('mail-ingest', 'Mail ingest', { schedule_mode: 'interval', form: { cadence: 'interval', minutes: 15, start: 7, end: 19, weekdays: true, offset: 0 } }),
  job('mail-brief', 'Mail brief', { consumer: 'mail', kind: 'mail', current_thread: true, after: ['mail-ingest'] }),
  job('invoices', 'Weekly invoices', { consumer: 'invoices', kind: 'invoices', schedule_mode: 'weekly', form: { cadence: 'weekly', day: 'Wed', time: '09:00' } }),
  job('inventory', 'Inventory', { consumer: 'inventory', status: 'never', active: false, enabled: false, output_error: true }),
  job('not-installed', 'Future automation', { installed: false, enabled: false, active: false }),
  job('other-timer', 'Other timer', { managed: false, form: null, schedule_mode: null }),
] };
let browser, page;
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 15000 }); }
function details(label) { return page.locator('details').filter({ has: page.locator('summary').filter({ hasText: label }) }).last(); }
async function openJob(label) {
  const item = details(label);
  if (!(await item.getAttribute('open') !== null)) await item.locator('summary').click();
  return item;
}
async function choose(label, text) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: text, exact: true }).click();
}
async function refresh() { await page.getByRole('button', { name: 'Refresh automations', exact: true }).click(); }
async function run() {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', colorScheme: 'dark' });
  await context.addInitScript(() => {
    localStorage.setItem('t3code:client-settings:v1', JSON.stringify({ onboardingCompletedAt: '2026-09-14T08:00:00Z' }));
  });
  await context.routeWebSocket('**/*', ws => { blocked.push(`WS ${ws.url()}`); ws.close(); });
  await context.route('**/*', async interception => {
    const request = interception.request(), url = new URL(request.url()), pathname = url.pathname;
    if (url.origin !== origin) { blocked.push(request.url()); return interception.abort(); }
    if (pathname.startsWith('/api/control-center/')) {
      const isModels = pathname.endsWith('/models'), state = isModels ? models : automations;
      const error = isModels ? modelsError : apiError;
      if (error) return interception.fulfill({ status: 503, json: { ok: false, error } });
      if (request.method() === 'POST') {
        const data = request.postDataJSON(); posts.push({ pathname, data });
        if (rejectWrite) return interception.fulfill({ status: 400, json: { ok: false, error: 'Schedule must remain after its prerequisite.' } });
        if (isModels) {
          const row = models.consumers.find(row => row.consumer === data.consumer);
          Object.assign(row, data.reset ? { model: row.default_model, effort: row.default_effort, source: 'default' } : { ...data, source: 'override' });
        } else {
          const row = automations.jobs.find(row => row.id === data.id);
          if (data.action === 'schedule') row.form = data.schedule;
          if (data.action === 'pause' || data.action === 'resume') row.active = row.enabled = data.action === 'resume';
          if (data.action === 'run') row.status = 'running';
        }
      }
      return interception.fulfill({ json: state });
    }
    if (request.method() !== 'GET') { blocked.push(`${request.method()} ${pathname}`); return interception.abort(); }
    const relative = pathname.startsWith('/assets/') ? pathname.slice(1) : pathname.startsWith('/settings') ? 'index.html' : pathname.slice(1);
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}/`)) return interception.abort();
    try {
      const contentType = ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' })[path.extname(file)] ?? 'application/octet-stream';
      return await interception.fulfill({ body: await fs.readFile(file), contentType });
    } catch { blocked.push(pathname); return interception.fulfill({ status: 404, body: 'No test fixture' }); }
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/settings/control-center`, { waitUntil: 'domcontentloaded' });
  await check('Desktop loads real Settings page with failed scan visible', async () => {
    await visible(page.getByRole('heading', { name: 'Automations', exact: true }));
    await visible(details('Drift scan').locator('summary').getByText('Failed', { exact: false }));
    await page.screenshot({ path: path.join(evidence, 'desktop.png'), fullPage: true });
  });
  await check('Failure report, dependency warning and duplicate brief gate', async () => {
    const drift = await openJob('Drift scan');
    await visible(drift.getByText('Result: 1 of 20 scans failed'));
    assert.equal(await drift.getByRole('link', { name: /Latest report/ }).getAttribute('href'), `${origin}/fixture-report`);
    const daybrief = await openJob('Daybrief');
    await visible(daybrief.getByText(/Dependency ordering needs installation/));
    assert(await daybrief.getByRole('button', { name: 'Start brief' }).isDisabled());
    const mail = await openJob('Mail brief');
    assert.equal(await mail.getByRole('button', { name: 'Start brief' }).count(), 0);
  });
  await check('Astra override and model-specific efforts use registry snapshot', async () => {
    assert.equal(await page.getByRole('combobox', { name: 'Daybrief model', exact: true }).innerText(), catalog.codex.labels['gpt-6-astra']);
    assert.equal(await page.getByRole('combobox', { name: 'Daybrief effort', exact: true }).innerText(), 'xhigh');
    await details('Daybrief').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(evidence, 'desktop-details.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await details('Daybrief').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(evidence, 'mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('combobox', { name: 'Daybrief effort', exact: true }).click();
    await visible(page.getByRole('option').first());
    assert.deepEqual(await page.getByRole('option').allTextContents(), catalog.codex.model_efforts['gpt-6-astra']);
    await page.getByRole('option', { name: 'ultra', exact: true }).click();
    await choose('Daybrief model', catalog.codex.labels['gpt-5.6-luna']);
    await page.getByRole('combobox', { name: 'Daybrief effort', exact: true }).click();
    await visible(page.getByRole('option').first());
    assert.deepEqual(await page.getByRole('option').allTextContents(), catalog.codex.model_efforts['gpt-5.6-luna']);
    await page.getByRole('option', { name: 'max', exact: true }).click();
    await details('Daybrief').getByRole('button', { name: 'Save', exact: true }).click();
    await visible(page.getByText('Daybrief route saved', { exact: true }));
    assert.deepEqual(posts.at(-1).data, { consumer: 'daybrief', engine: 'codex', model: 'gpt-5.6-luna', effort: 'max' });
    await page.getByRole('button', { name: /Reset Daybrief model routing/ }).click();
    await visible(page.getByText('Daybrief back to its repo default', { exact: true }));
  });
  await check('Cadence, weekly day and ingest window remain explicit', async () => {
    const ingest = await openJob('Mail ingest');
    await choose('Mail ingest frequency', 'Every 30 min');
    await ingest.getByRole('button', { name: 'Save schedule' }).click();
    await visible(ingest.getByText('Every 30 min · weekdays 7:00–19:59', { exact: true }));
    assert.deepEqual(posts.at(-1).data.schedule, { cadence: 'interval', minutes: 30, start: 7, end: 19, weekdays: true, offset: 0 });
    await openJob('Weekly invoices');
    assert(await page.getByRole('combobox', { name: 'Weekly invoices frequency' }).isDisabled());
    await page.getByRole('textbox', { name: 'Weekly invoices time' }).count();
  });
  await check('Pause/resume round trip and run gate', async () => {
    const drift = await openJob('Drift scan');
    await drift.getByRole('button', { name: 'Pause', exact: true }).click();
    await visible(drift.getByRole('button', { name: 'Resume', exact: true }));
    await drift.getByRole('button', { name: 'Resume', exact: true }).click();
    await visible(drift.getByRole('button', { name: 'Pause', exact: true }));
    await drift.getByRole('button', { name: 'Run now', exact: true }).click();
    await visible(drift.locator('summary').getByText(/Running/));
    assert(await drift.getByRole('button', { name: 'Run now' }).isDisabled());
  });
  await check('Write rejection and stale-read errors stay visible', async () => {
    rejectWrite = true;
    const daybrief = await openJob('Daybrief');
    await page.getByLabel('Daybrief time', { exact: true }).fill('06:00');
    await daybrief.getByRole('button', { name: 'Save schedule' }).click();
    await visible(page.getByText('Schedule must remain after its prerequisite.', { exact: true }));
    rejectWrite = false; apiError = 'Scheduler temporarily unavailable';
    await refresh();
    await visible(page.getByRole('alert').filter({ hasText: 'The status below is from the previous refresh.' }));
    apiError = null; await refresh();
    await page.getByRole('alert').filter({ hasText: 'Scheduler temporarily unavailable' }).waitFor({ state: 'hidden' });
  });
  await check('Unmanaged and uninstalled jobs cannot be edited', async () => {
    const future = await openJob('Future automation');
    assert.equal(await future.getByRole('button').count(), 0);
    await page.locator('summary').filter({ hasText: 'Other host automations' }).click();
    const other = await openJob('Other timer');
    assert.equal(await other.getByRole('button').count(), 0);
    const inventory = await openJob('Inventory');
    await visible(inventory.getByText('The latest report or thread could not be read.'));
  });
  await check('Narrow layout keeps controls inside viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('combobox', { name: 'Daybrief model', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, 'mobile-error-state.png') });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('button,input,[role="combobox"]')].filter(el => {
      const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (box.right > innerWidth + 1 || box.left < -1);
    }).map(el => ({ text: el.getAttribute('aria-label') || el.textContent, box: el.getBoundingClientRect().toJSON() })));
    assert.deepEqual(overflow, []);
  });
  await check('Fresh API failure exposes fallback model routes and recovers', async () => {
    apiError = 'Scheduler temporarily unavailable';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await visible(page.getByRole('alert').filter({ hasText: apiError }));
    await visible(page.getByRole('combobox', { name: 'Drift scan model', exact: true }));
    apiError = null; await refresh();
    await visible(details('Drift scan').locator('summary'));
    modelsError = 'Model registry temporarily unavailable';
    await page.getByRole('button', { name: 'Refresh model routing' }).click();
    await visible(page.getByText('Model routing is unavailable', { exact: true }).first());
    modelsError = null;
    await page.getByRole('button', { name: 'Refresh model routing' }).click();
    await visible(page.getByRole('combobox', { name: 'Shared helper model', exact: true }));
  });
  await check('No uncaught application errors', async () => assert.deepEqual(errors, []));
}
run().catch(async error => {
  console.error(error); process.exitCode = 1;
  if (page) {
    await fs.writeFile(path.join(evidence, 'failure-body.txt'), await page.locator('body').innerText()).catch(() => {});
    await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  }
}).finally(async () => {
  await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify({ checks, posts, blocked, errors, passed: !process.exitCode }, null, 2));
  await browser?.close();
});
