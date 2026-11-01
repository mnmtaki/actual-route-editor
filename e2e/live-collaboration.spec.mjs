import { test, expect } from '@playwright/test';

const API = 'http://127.0.0.1:8080';
const SITE = 'http://127.0.0.1:5173';
const suffix = () => Math.random().toString(36).slice(2, 11);
async function registerAndLogin(context, username) {
  const password = 'browser-test-password-123';
  const registered = await context.request.post(API + '/api/auth/register', {
    data: { username, password },
  });
  expect(registered.status()).toBe(201);
  const logged = await context.request.post(API + '/api/auth/login', {
    data: { username, password },
  });
  expect(logged.status()).toBe(200);
  const cookies = await context.cookies(API);
  const csrf = cookies.find(cookie => cookie.name === 'ara_csrf')?.value;
  expect(csrf).toBeTruthy();
  return csrf;
}
async function write(context, csrf, endpoint, body, method = 'POST') {
  const response = await context.request.fetch(API + endpoint, {
    method, data: body, headers: { 'X-ARA-CSRF': csrf, Origin: SITE },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function openCanvas(context, id) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const failedRequests = [];
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push(request.url() + ' ' + request.failure()?.errorText));
  await page.goto(SITE + '/?cloudProject=' + id);
  try {
    await expect(page.getByRole('region', { name: '协同工作区' })).toBeVisible({ timeout: 20000 });
  } catch (failure) {
    console.error('BROWSER DEBUG:', {
      pageErrors: errors,
      consoleErrors,
      failedRequests,
      url: page.url(),
      body: (await page.locator('body').innerText()).slice(0, 5000),
      crossOriginProbe: await context.request.get('http://127.0.0.1:8080/api/auth/me', { headers: { Origin: SITE } })
        .then(async response => ({status: response.status(), headers: response.headers(), body: await response.text()})),
      apiUser: await page.evaluate(async () => {
        try {
          const response = await fetch('http://127.0.0.1:8080/api/auth/me', {credentials:'include'});
          return {status: response.status, body: await response.text()};
        } catch(error) { return String(error); }
      }),
    });
    throw failure;
  }
  await expect(page.getByText('WebSocket 已连接')).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
  return page;
}

test('two browser contexts merge distinct stations and update both rendered canvases', async ({ browser }) => {
  const owner = await browser.newContext();
  const guest = await browser.newContext();
  try {
    const ownerName = 'browserOwner' + suffix();
    const guestName = 'browserEditor' + suffix();
    const ownerCsrf = await registerAndLogin(owner, ownerName);
    await registerAndLogin(guest, guestName);
    const ownerBootstrap = await owner.newPage();
    await ownerBootstrap.goto(SITE);
    const empty = await ownerBootstrap.evaluate(async () => {
      const module = await import('/src/data/storage.ts');
      return module.createEmptyProject();
    });
    await ownerBootstrap.close();
    const project = await write(owner, ownerCsrf, '/api/projects', {
      name: 'Browser Collaboration', document: empty,
    });
    const id = project.id;
    await write(owner, ownerCsrf, '/api/projects/' + id + '/access-rules', {
      username: guestName, action: 'edit', allowed: true,
    });

    const a = await openCanvas(owner, id);
    const b = await openCanvas(guest, id);
    await a.getByRole('textbox', { name: '新车站名称' }).fill('浏览器A站');
    await b.getByRole('textbox', { name: '新车站名称' }).fill('浏览器B站');
    // Issue two canvas edits without waiting for either cloud response.
    await Promise.all([
      a.getByRole('button', { name: '新增独立车站', exact: true }).click(),
      b.getByRole('button', { name: '新增独立车站', exact: true }).click(),
    ]);
    await expect.poll(async () => {
      const response = await owner.request.get(API + '/api/projects/' + id);
      const data = await response.json();
      return data.document.stations.map(station => station.name).sort();
    }, { timeout: 20000 }).toEqual(['浏览器A站', '浏览器B站']);

    // The cloud state is authoritative, but both open browser canvases
    // must converge as well; API-only success would not pass this test.
    for (const page of [a, b]) {
      const status = page.getByRole('region', { name: '协同工作区' });
      await expect(status.getByText(/本地基线 v3 · 远端 v3/)).toBeVisible({ timeout: 20000 });
      await expect(page.locator('svg').getByText('浏览器A站').first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('svg').getByText('浏览器B站').first()).toBeVisible({ timeout: 15000 });
      await expect(status.getByText('WebSocket 已连接')).toBeVisible();
    }
    await a.screenshot({ path: 'test-results/owner-canvas.png', fullPage: true });
    await b.screenshot({ path: 'test-results/peer-canvas.png', fullPage: true });
  } finally {
    await owner.close();
    await guest.close();
  }
});
