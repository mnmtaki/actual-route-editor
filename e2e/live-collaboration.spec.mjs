import { readFile } from 'node:fs/promises';
import { test, expect, request } from '@playwright/test';

const API = 'http://127.0.0.1:8080';
const SITE = 'http://127.0.0.1:5173';
const suffix = () => Math.random().toString(36).slice(2, 11);
// Keep one identity per CI run even if Playwright restarts its worker after
// a failure. Otherwise the register-ip limiter is exhausted by retries.
const runSuffix = (process.env.GITHUB_RUN_ID || suffix()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
const USERS = { owner: 'e2eOwner' + runSuffix, peer: 'e2eEditor' + runSuffix };
const PASSWORD = 'browser-test-password-123';
// One authenticated session per test identity PER Playwright worker. Every
// browser context gets an isolated copy of that session's cookies; repeating
// login for every test otherwise trips the production login-user limiter.
const authCookies = new Map();
test.beforeAll(async () => {
  const api = await request.newContext();
  try {
    for (const username of Object.values(USERS)) {
      const credentials = { username, password: PASSWORD };
      let login = await api.post(API + '/api/auth/login', { data: credentials });
      if (login.status() !== 200) {
        const registration = await api.post(API + '/api/auth/register', {
          data: credentials,
        });
        expect([201, 409], 'test account registration: ' +
          await registration.text()).toContain(registration.status());
        login = await api.post(API + '/api/auth/login', { data: credentials });
        expect(login.status(), 'test account login: ' +
          await login.text()).toBe(200);
      }
      const state = await api.storageState();
      const cookies = state.cookies.filter(cookie =>
        ['ara_session', 'ara_csrf'].includes(cookie.name));
      expect(cookies.map(cookie=>cookie.name).sort()).toEqual(['ara_csrf','ara_session']);
      authCookies.set(username,cookies);
    }
  } finally {
    await api.dispose();
  }
});
async function registerAndLogin(context, username) {
  const cookies = authCookies.get(username);
  expect(cookies, 'missing E2E fixture cookies for ' + username).toBeTruthy();
  await context.addCookies(cookies);
  const inContext = await context.cookies(API);
  const csrf = inContext.find(cookie => cookie.name === 'ara_csrf')?.value;
  expect(csrf).toBeTruthy();
  const identity = await context.request.get(API + '/api/auth/me');
  expect(identity.status(), 'stored E2E session must be authenticated').toBe(200);
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
    const ownerName = USERS.owner;
    const guestName = USERS.peer;
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

test('two actual browser canvases converge after disjoint segment waypoint moves', async ({ browser }) => {
  const owner = await browser.newContext();
  const peer = await browser.newContext();
  try {
    const ownerName = USERS.owner;
    const peerName = USERS.peer;
    const ownerCsrf = await registerAndLogin(owner, ownerName);
    const peerCsrf = await registerAndLogin(peer, peerName);
    const seedPage = await owner.newPage();
    await seedPage.goto(SITE);
    const demo = await seedPage.evaluate(async () => {
      const module = await import('/src/data/demo.ts');
      return module.demoProject;
    });
    await seedPage.close();
    const created = await write(owner, ownerCsrf, '/api/projects', {
      name: 'Two Segments', document: demo,
    });
    const id = created.id;
    await write(owner, ownerCsrf, '/api/projects/' + id + '/access-rules', {
      username: peerName, action: 'edit', allowed: true,
    });
    const a = await openCanvas(owner, id);
    const b = await openCanvas(peer, id);
    const lineA = '[data-segment-id="a-1"] path.segment-main';
    const lineB = '[data-segment-id="a-2"] path.segment-main';
    await expect(a.locator(lineA).first()).toBeAttached();
    await expect(b.locator(lineB).first()).toBeAttached();
    const originalA = await a.locator(lineA).first().getAttribute('d');
    const originalB = await b.locator(lineB).first().getAttribute('d');

    const path = '/api/projects/' + id + '/operations/waypoint';
    await Promise.all([
      write(owner, ownerCsrf, path, {
        operationId: crypto.randomUUID(), expectedRevision: 1,
        segmentId: 'a-1', waypointId: 'w1', x: 318, y: 479,
      }),
      write(peer, peerCsrf, path, {
        operationId: crypto.randomUUID(), expectedRevision: 1,
        segmentId: 'a-2', waypointId: 'w2', x: 490, y: 267,
      }),
    ]);
    for (const page of [a,b]) {
      await expect(page.getByRole('region', { name: '协同工作区' })
        .getByText(/本地基线 v3 · 远端 v3/)).toBeVisible({ timeout: 20000 });
      await expect.poll(() => page.locator(lineA).first().getAttribute('d'),
        { timeout: 10000 }).not.toEqual(originalA);
      await expect.poll(() => page.locator(lineB).first().getAttribute('d'),
        { timeout: 10000 }).not.toEqual(originalB);
    }
    const aPathA = await a.locator(lineA).first().getAttribute('d');
    const bPathA = await b.locator(lineA).first().getAttribute('d');
    const aPathB = await a.locator(lineB).first().getAttribute('d');
    const bPathB = await b.locator(lineB).first().getAttribute('d');
    expect(aPathA).toEqual(bPathA);
    expect(aPathB).toEqual(bPathB);
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('browser UI appends an existing station to line terminal and peer sees topology', async ({ browser }) => {
  const owner=await browser.newContext();
  const peer=await browser.newContext();
  try {
    const ownerName=USERS.owner;
    const peerName=USERS.peer;
    const csrf=await registerAndLogin(owner,ownerName);
    await registerAndLogin(peer,peerName);
    const init=await owner.newPage();
    await init.goto(SITE);
    const demo=await init.evaluate(async () => (await import('/src/data/demo.ts')).demoProject);
    await init.close();
    const created=await write(owner,csrf,'/api/projects',{
      name:'Topology Collaboration',document:demo,
    });
    const id=created.id;
    await write(owner,csrf,'/api/projects/'+id+'/access-rules',{
      username:peerName,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    const b=await openCanvas(peer,id);
    await a.getByLabel('待扩展线路').selectOption('line-a');
    await a.getByLabel('连接目标车站').selectOption('s5');
    await a.getByRole('button',{name:'将已有车站接到线路末端'}).click();
    await expect.poll(async () => {
      const result=await owner.request.get(API+'/api/projects/'+id);
      const state=await result.json();
      return {
        revision:state.revision,
        sequence:state.document.lines.find(line => line.id==='line-a').stationSequence,
        segmentCount:state.document.geometry.segments.length,
        membership:state.document.stationLineRelations.some(rel=>
          rel.lineId==='line-a' && rel.stationId==='s5'),
      };
    },{timeout:20000}).toEqual({
      revision:2,sequence:['s1','s2','s3','s4','s5'],segmentCount:8,membership:true,
    });
    for(const page of [a,b]) {
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v2 · 远端 v2/)).toBeVisible({timeout:20000});
      await expect(page.locator('[data-layer="segments"] path.segment-main'))
        .toHaveCount(8,{timeout:20000});
      await expect(page.getByText('WebSocket 已连接')).toBeVisible();
    }
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('two browser canvases display a split segment and inserted station', async ({ browser }) => {
  const owner=await browser.newContext();
  const peer=await browser.newContext();
  try {
    const ownerCsrf=await registerAndLogin(owner,USERS.owner);
    await registerAndLogin(peer,USERS.peer);
    const bootstrap=await owner.newPage();
    await bootstrap.goto(SITE);
    const seed=await bootstrap.evaluate(async ()=>(await import('/src/data/demo.ts')).demoProject);
    await bootstrap.close();
    const created=await write(owner,ownerCsrf,'/api/projects',{
      name:'Split-Station Collaboration',document:seed,
    });
    const id=created.id;
    await write(owner,ownerCsrf,'/api/projects/'+id+'/access-rules',{
      username:USERS.peer,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    const b=await openCanvas(peer,id);
    await a.getByLabel('待拆分区间').selectOption('a-1');
    await a.getByLabel('区间插入位置').selectOption('0');
    await a.getByLabel('插入车站名称').fill('协作插入站');
    await a.getByRole('button',{name:'在区间中插入车站'}).click();
    await expect.poll(async () => {
      const response=await owner.request.get(API+'/api/projects/'+id);
      const project=await response.json();
      const line=project.document.lines.find(item=>item.id==='line-a');
      const members=project.document.stationLineRelations;
      const segments=project.document.geometry.segments;
      const newStation=project.document.stations.find(station=>station.name==='协作插入站');
      return {
        revision:project.revision,
        totalStations:project.document.stations.length,
        totalSegments:segments.length,
        sequenceLength:line.stationSequence.length,
        originalExists:segments.some(segment=>segment.id==='a-1'),
        hasFirst:segments.some(segment=>segment.fromStationId==='s1'
          && segment.toStationId===newStation?.id),
        hasSecond:segments.some(segment=>segment.fromStationId===newStation?.id
          && segment.toStationId==='s2'),
        hasRelation:members.some(relation=>relation.stationId===newStation?.id
          && relation.lineId==='line-a'),
      };
    },{timeout:20000}).toEqual({
      revision:2,totalStations:9,totalSegments:8,sequenceLength:5,
      originalExists:false,hasFirst:true,hasSecond:true,hasRelation:true,
    });
    for(const page of [a,b]) {
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v2 · 远端 v2/)).toBeVisible({timeout:20000});
      await expect(page.locator('svg').getByText('协作插入站').first()).toBeVisible({timeout:15000});
      await expect(page.locator('[data-layer="segments"] path.segment-main'))
        .toHaveCount(8,{timeout:20000});
      await expect(page.getByText('WebSocket 已连接')).toBeVisible();
    }
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('two browser canvases converge after middle-station deletion and segment merge', async ({ browser }) => {
  const owner=await browser.newContext();
  const peer=await browser.newContext();
  try {
    const ownerCsrf=await registerAndLogin(owner,USERS.owner);
    await registerAndLogin(peer,USERS.peer);
    const bootstrap=await owner.newPage();
    await bootstrap.goto(SITE);
    const seed=await bootstrap.evaluate(async ()=>(await import('/src/data/demo.ts')).demoProject);
    await bootstrap.close();
    const created=await write(owner,ownerCsrf,'/api/projects',{
      name:'Middle Station Removal',document:seed,
    });
    const id=created.id;
    await write(owner,ownerCsrf,'/api/projects/'+id+'/access-rules',{
      username:USERS.peer,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    const b=await openCanvas(peer,id);
    await a.getByLabel('待合并线路').selectOption('line-a');
    await a.getByLabel('待移除中间车站').selectOption('s3');
    a.once('dialog', dialog=>void dialog.accept());
    await a.getByRole('button',{name:'删除中间站并合并区间'}).click();
    await expect.poll(async()=>{
      const response=await owner.request.get(API+'/api/projects/'+id);
      const project=await response.json();
      const line=project.document.lines.find(line=>line.id==='line-a');
      const segments=project.document.geometry.segments;
      const merged=segments.find(segment=>
        segment.fromStationId==='s2' && segment.toStationId==='s4');
      return {
        revision:project.revision,
        stations:project.document.stations.length,
        segmentCount:segments.length,
        sequence:line.stationSequence,
        memberRemoved:!project.document.stationLineRelations.some(
          relation=>relation.stationId==='s3' && relation.lineId==='line-a'),
        oldSegmentsAbsent:!segments.some(segment=>segment.id==='a-2' || segment.id==='a-3'),
        mergedWaypoints:merged?.waypoints?.map(point=>[point.x,point.y]),
      };
    },{timeout:20000}).toEqual({
      revision:2,stations:7,segmentCount:6,sequence:['s1','s2','s4'],
      memberRemoved:true,oldSegmentsAbsent:true,
      mergedWaypoints:[[500,300],[620,430],[760,430]],
    });
    for(const page of [a,b]){
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v2 · 远端 v2/)).toBeVisible({timeout:20000});
      await expect(page.locator('svg').getByText('青塔')).toHaveCount(0);
      await expect(page.locator('[data-layer="segments"] path.segment-main'))
        .toHaveCount(6,{timeout:20000});
      await expect(page.getByText('WebSocket 已连接')).toBeVisible();
    }
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('actor-only station compensation converges in two browser canvases', async ({ browser }) => {
  const owner=await browser.newContext();
  const peer=await browser.newContext();
  try {
    const csrf=await registerAndLogin(owner,USERS.owner);
    await registerAndLogin(peer,USERS.peer);
    const bootstrap=await owner.newPage();
    await bootstrap.goto(SITE);
    const seed=await bootstrap.evaluate(async ()=>(await import('/src/data/demo.ts')).demoProject);
    await bootstrap.close();
    const created=await write(owner,csrf,'/api/projects',{
      name:'Collaborative Compensation',document:seed,
    });
    const id=created.id;
    await write(owner,csrf,'/api/projects/'+id+'/access-rules',{
      username:USERS.peer,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    const b=await openCanvas(peer,id);
    const operationId=crypto.randomUUID();
    await write(owner,csrf,'/api/projects/'+id+'/operations',{
      operationId,expectedRevision:1,type:'station.rename',
      station:{id:'s3',name:'协同改名站'},
    });
    for(const page of [a,b]) {
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v2 · 远端 v2/)).toBeVisible({timeout:20000});
      await expect(page.locator('svg').getByText('协同改名站').first()).toBeVisible();
    }
    const toolbar=a.getByRole('region',{name:'协同工作区'});
    await toolbar.getByLabel('我的撤销重做操作').selectOption(operationId);
    await toolbar.getByRole('button',{name:'撤销本人操作'}).click();
    for(const page of [a,b]) {
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v3 · 远端 v3/)).toBeVisible({timeout:20000});
      await expect(page.locator('svg').getByText('青塔').first()).toBeVisible();
      await expect(page.locator('svg').getByText('协同改名站')).toHaveCount(0);
    }
    await toolbar.getByLabel('我的撤销重做操作').selectOption(operationId);
    await toolbar.getByRole('button',{name:'重做本人操作'}).click();
    for(const page of [a,b]) {
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v4 · 远端 v4/)).toBeVisible({timeout:20000});
      await expect(page.locator('svg').getByText('协同改名站').first()).toBeVisible();
    }
    const final=await owner.request.get(API+'/api/projects/'+id);
    const state=await final.json();
    expect(state.revision).toBe(4);
    expect(state.document.stations.find(station=>station.id==='s3').name).toBe('协同改名站');
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('collaboration history and conflict recovery preserve the local canvas and export backup', async ({ browser }) => {
  const owner = await browser.newContext({ acceptDownloads: true });
  const peer = await browser.newContext();
  try {
    const ownerCsrf=await registerAndLogin(owner,USERS.owner);
    const peerCsrf=await registerAndLogin(peer,USERS.peer);
    const bootstrap=await owner.newPage();
    await bootstrap.goto(SITE);
    const seed=await bootstrap.evaluate(async ()=>(await import('/src/data/storage.ts')).createEmptyProject());
    await bootstrap.close();
    const created=await write(owner,ownerCsrf,'/api/projects',{
      name:'Recovery Preview Project',document:seed,
    });
    const id=created.id;
    await write(owner,ownerCsrf,'/api/projects/'+id+'/access-rules',{
      username:USERS.peer,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    await a.getByLabel('新车站名称').fill('尚未发布的本地站');
    let intercepted=false;
    await a.route('**/api/projects/*/operations',async route=>{
      if(route.request().method() !== 'POST' || intercepted) return route.continue();
      intercepted=true;
      const remoteCopy={...seed,name:'云端修改了项目名称'};
      await write(peer,peerCsrf,'/api/projects/'+id,{
        name:'远端保存',document:remoteCopy,expectedRevision:1,
      },'PUT');
      // Test the UI on an explicit stale-write response; real server-side
      // 409 rejection is independently covered by PostgreSQL integration tests.
      await route.fulfill({
        status:409,
        headers:{
          'access-control-allow-origin':SITE,
          'access-control-allow-credentials':'true',
          'content-type':'application/json',
        },
        body:JSON.stringify({detail:'工程版本冲突'}),
      });
    });
    await a.getByRole('button',{name:'新增独立车站',exact:true}).click();
    const recovery=a.getByLabel('协同冲突处理');
    try {
      await expect(recovery).toBeVisible({timeout:20000});
    } catch (failure) {
      console.error('RECOVERY DEBUG', {
        intercepted,
        body: (await a.locator('body').innerText()).slice(0,5000),
        revision: (await (await owner.request.get(API+'/api/projects/'+id)).json()).revision,
      });
      throw failure;
    }
    await expect(a.getByRole('alert')).toContainText('冲突');
    await recovery.getByRole('button',{name:'刷新云端差异'}).click();
    await expect(recovery.getByText(/云端相对基线：车站 0/)).toBeVisible();
    await expect(recovery.getByText(/本地相对基线：车站 1/)).toBeVisible();
    await a.getByRole('button',{name:'查看操作历史'}).click();
    const history=a.getByLabel('协同操作历史');
    await expect(history).toContainText(USERS.peer);
    await expect(history).toContainText('完整工程保存');
    const [download]=await Promise.all([
      a.waitForEvent('download'),
      recovery.getByRole('button',{name:'先导出本地 JSON 备份'}).click(),
    ]);
    const bytes=await readFile(await download.path(),'utf8');
    const backup=JSON.parse(bytes);
    expect(backup.stations.some(station=>station.name==='尚未发布的本地站')).toBe(true);
    // No comparison or backup action is permitted to replace the unsaved canvas.
    await expect(a.locator('svg').getByText('尚未发布的本地站').first()).toBeVisible();
    const cloud=await owner.request.get(API+'/api/projects/'+id);
    const current=await cloud.json();
    expect(current.revision).toBe(2);
    expect(current.document.stations.some(station=>station.name==='尚未发布的本地站')).toBe(false);
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('normal line drawing tool syncs first and next stations without collaboration buttons', async ({ browser }) => {
  const owner = await browser.newContext();
  const peer = await browser.newContext();
  try {
    const csrf = await registerAndLogin(owner, USERS.owner);
    await registerAndLogin(peer, USERS.peer);
    const bootstrap = await owner.newPage();
    await bootstrap.goto(SITE);
    const empty = await bootstrap.evaluate(async () =>
      (await import('/src/data/storage.ts')).createEmptyProject());
    await bootstrap.close();
    const created = await write(owner, csrf, '/api/projects', {
      name: 'Ordinary Canvas Drawing', document: empty,
    });
    const id = created.id;
    await write(owner, csrf, '/api/projects/' + id + '/access-rules', {
      username: USERS.peer, action: 'edit', allowed: true,
    });
    const a = await openCanvas(owner, id);
    const b = await openCanvas(peer, id);

    // Use the SAME controls as the single-user drawing workflow.
    await a.getByRole('button', { name: '＋ 新建线路' }).click();
    await a.locator('.line-dialog').getByRole('button', { name: '开始绘制' }).click();
    const drawing = a.locator('#network-canvas');
    await expect(drawing).toHaveClass(/is-drawing/);

    // The newly created line and opening phase must be saved even though
    // drawing mode is still active.
    await expect.poll(async () => {
      const res = await owner.request.get(API + '/api/projects/' + id);
      const data = await res.json();
      return { lines: data.document.lines.length, phases: data.document.openingPhases.length };
    }, { timeout: 20000 }).toEqual({ lines: 1, phases: 1 });

    await drawing.click({ position: { x: 390, y: 90 } });
    await expect.poll(async () => {
      const res = await owner.request.get(API + '/api/projects/' + id);
      const data = await res.json();
      return { stations: data.document.stations.length, relations: data.document.stationLineRelations.length };
    }, { timeout: 20000 }).toEqual({ stations: 1, relations: 1 });

    // Cloud acknowledgement must not close the normal line drawing tool.
    await expect(drawing).toHaveClass(/is-drawing/);
    await drawing.click({ position: { x: 700, y: 145 } });
    await a.getByRole('button', { name: '完成绘制' }).click();
    await expect.poll(async () => {
      const res = await owner.request.get(API + '/api/projects/' + id);
      const data = await res.json();
      return {
        stations: data.document.stations.length,
        segments: data.document.geometry.segments.length,
        phaseSegments: data.document.openingPhases[0]?.segmentIds.length,
      };
    }, { timeout: 20000 }).toEqual({
      stations: 2, segments: 1, phaseSegments: 1,
    });

    await expect.poll(async () => {
      const res = await peer.request.get(API + '/api/projects/' + id);
      const data = await res.json();
      return data.document.lines[0]?.stationSequence.length;
    }, { timeout: 20000 }).toBe(2);
    await expect(b.getByRole('region', { name: '协同工作区' })
      .getByText(/本地基线 v4 · 远端 v4/))
      .toBeVisible({ timeout: 20000 });
    await expect(b.locator('[data-layer="segments"] path.segment-main'))
      .toHaveCount(1, { timeout: 20000 });
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('two browser sessions converge after simultaneous independent line topology operations', async ({ browser }) => {
  const owner = await browser.newContext();
  const peer = await browser.newContext();
  try {
    const ownerCsrf = await registerAndLogin(owner, USERS.owner);
    const peerCsrf = await registerAndLogin(peer, USERS.peer);
    const bootstrap = await owner.newPage();
    await bootstrap.goto(SITE);
    const seed = await bootstrap.evaluate(async () => {
      const { createEmptyProject } = await import('/src/data/storage.ts');
      const project = createEmptyProject();
      project.lines = [
        { id: 'line-a', name: 'A', color: '#123456', lineOrder: 0, visible: true,
          locked: false, stationSequence: ['a'] },
        { id: 'line-b', name: 'B', color: '#654321', lineOrder: 1, visible: true,
          locked: false, stationSequence: ['b'] },
      ];
      project.stations = [
        { id: 'a', name: 'Origin A', x: 100, y: 100, labelOffsetX: 14, labelOffsetY: -14 },
        { id: 'b', name: 'Origin B', x: 500, y: 400, labelOffsetX: 14, labelOffsetY: -14 },
      ];
      project.stationLineRelations = [
        { id: 'ra', stationId: 'a', lineId: 'line-a' },
        { id: 'rb', stationId: 'b', lineId: 'line-b' },
      ];
      return project;
    });
    await bootstrap.close();
    const created = await write(owner, ownerCsrf, '/api/projects', {
      name: 'Independent Topology', document: seed,
    });
    const id = created.id;
    await write(owner, ownerCsrf, '/api/projects/' + id + '/access-rules', {
      username: USERS.peer, action: 'edit', allowed: true,
    });
    const a = await openCanvas(owner, id);
    const b = await openCanvas(peer, id);
    const operation = (line, from, target, segment, relation) => ({
      operationId: crypto.randomUUID(), expectedRevision: 1,
      lineId: line, fromStationId: from,
      station: { id: target, name: 'Added ' + target,
        x: line === 'line-a' ? 240 : 650,
        y: line === 'line-a' ? 120 : 440,
        labelOffsetX: 14, labelOffsetY: -14 },
      relation: { id: relation, stationId: target, lineId: line,
        openedAt: seed.timeline.currentDate, closedAt: null },
      segment: { id: segment, lineId: line, fromStationId: from,
        toStationId: target, mode: 'straight', structureType: 'underground',
        structureNodes: [], waypoints: [],
        openedAt: seed.timeline.currentDate, closedAt: null },
    });
    const endpoint = '/api/projects/' + id + '/operations/line-append-new';
    const [first, second] = await Promise.all([
      write(owner, ownerCsrf, endpoint,
        operation('line-a', 'a', 'c', 'ac', 'rc')),
      write(peer, peerCsrf, endpoint,
        operation('line-b', 'b', 'd', 'bd', 'rd')),
    ]);
    expect(new Set([first.revision, second.revision])).toEqual(new Set([2, 3]));
    const cloud = await (await owner.request.get(API + '/api/projects/' + id)).json();
    expect(cloud.document.lines.find(line => line.id === 'line-a').stationSequence)
      .toEqual(['a', 'c']);
    expect(cloud.document.lines.find(line => line.id === 'line-b').stationSequence)
      .toEqual(['b', 'd']);
    for (const page of [a, b]) {
      await expect(page.getByRole('region', { name: '协同工作区' })
        .getByText(/本地基线 v3 · 远端 v3/))
        .toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-layer="segments"] path.segment-main'))
        .toHaveCount(2, { timeout: 20000 });
      await expect(page.locator('svg').getByText('Added c').first()).toBeVisible();
      await expect(page.locator('svg').getByText('Added d').first()).toBeVisible();
    }
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('two editors create independent native lines concurrently through regular toolbar', async ({ browser }) => {
  const owner=await browser.newContext();
  const peer=await browser.newContext();
  try {
    const ownerCsrf=await registerAndLogin(owner,USERS.owner);
    await registerAndLogin(peer,USERS.peer);
    const bootstrap=await owner.newPage();
    await bootstrap.goto(SITE);
    const empty=await bootstrap.evaluate(async ()=>
      (await import('/src/data/storage.ts')).createEmptyProject());
    await bootstrap.close();
    const created=await write(owner,ownerCsrf,'/api/projects',{
      name:'Two Concurrent Native Lines',document:empty,
    });
    const id=created.id;
    await write(owner,ownerCsrf,'/api/projects/'+id+'/access-rules',{
      username:USERS.peer,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    const b=await openCanvas(peer,id);
    await Promise.all([
      a.getByRole('button',{name:'＋ 新建线路'}).click(),
      b.getByRole('button',{name:'＋ 新建线路'}).click(),
    ]);
    await a.locator('.line-dialog input').first().fill('Owner Line');
    await b.locator('.line-dialog input').first().fill('Peer Line');
    await Promise.all([
      a.locator('.line-dialog').getByRole('button',{name:'开始绘制'}).click(),
      b.locator('.line-dialog').getByRole('button',{name:'开始绘制'}).click(),
    ]);
    await expect.poll(async ()=>{
      const result=await (await owner.request.get(API+'/api/projects/'+id)).json();
      return {revision:result.revision,
        names:result.document.lines.map(line=>line.name).sort(),
        phases:result.document.openingPhases.length};
    },{timeout:30000}).toEqual({
      revision:3,names:['Owner Line','Peer Line'],phases:2,
    });
    for(const page of [a,b]) {
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v3 · 远端 v3/))
        .toBeVisible({timeout:20000});
    }
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('same-account tabs keep independent pending operations during concurrent line creation', async ({ browser }) => {
  const context=await browser.newContext();
  try {
    const csrf=await registerAndLogin(context,USERS.owner);
    const bootstrap=await context.newPage();
    await bootstrap.goto(SITE);
    const empty=await bootstrap.evaluate(async ()=>
      (await import('/src/data/storage.ts')).createEmptyProject());
    await bootstrap.close();
    const created=await write(context,csrf,'/api/projects',{
      name:'Same Account Two Tabs',document:empty,
    });
    const id=created.id;
    const first=await openCanvas(context,id);
    const second=await openCanvas(context,id);
    await Promise.all([
      first.getByRole('button',{name:'＋ 新建线路'}).click(),
      second.getByRole('button',{name:'＋ 新建线路'}).click(),
    ]);
    await first.locator('.line-dialog input').first().fill('Tab One');
    await second.locator('.line-dialog input').first().fill('Tab Two');
    await Promise.all([
      first.locator('.line-dialog').getByRole('button',{name:'开始绘制'}).click(),
      second.locator('.line-dialog').getByRole('button',{name:'开始绘制'}).click(),
    ]);
    await expect.poll(async ()=>{
      const response=await context.request.get(API+'/api/projects/'+id);
      const doc=(await response.json()).document;
      return doc.lines.map(line=>line.name).sort();
    },{timeout:30000}).toEqual(['Tab One','Tab Two']);
    for(const page of [first,second])
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v3 · 远端 v3/))
        .toBeVisible({timeout:20000});
  } finally {
    await context.close();
  }
});

test('same-station concurrent writes produce one winner and never lose a version', async ({ browser }) => {
  const owner=await browser.newContext();
  const peer=await browser.newContext();
  try {
    const ownerCsrf=await registerAndLogin(owner,USERS.owner);
    const peerCsrf=await registerAndLogin(peer,USERS.peer);
    const bootstrap=await owner.newPage();
    await bootstrap.goto(SITE);
    const seed=await bootstrap.evaluate(async ()=>{
      const project=(await import('/src/data/storage.ts')).createEmptyProject();
      project.stations.push({
        id:'shared-station',name:'Original',x:100,y:200,
        labelOffsetX:14,labelOffsetY:-14,
      });
      return project;
    });
    await bootstrap.close();
    const created=await write(owner,ownerCsrf,'/api/projects',{
      name:'Shared Station Concurrent Conflict',document:seed,
    });
    const id=created.id;
    await write(owner,ownerCsrf,'/api/projects/'+id+'/access-rules',{
      username:USERS.peer,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    const b=await openCanvas(peer,id);
    const endpoint=API+'/api/projects/'+id+'/operations';
    const body=(name)=>({
      operationId:crypto.randomUUID(),expectedRevision:1,
      type:'station.rename',station:{id:'shared-station',name},
    });
    // Issue both writes from the already authenticated browser tabs.
    // This checks the same cookie + CSRF flow as the real editor, avoiding
    // divergence between Playwright API contexts and browser cookie state.
    const postFromCanvas=(page,csrf,payload)=>page.evaluate(async ({url,csrf,payload})=>{
      const response=await fetch(url,{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json','X-ARA-CSRF':csrf},
        body:JSON.stringify(payload),
      });
      return {status:response.status,body:await response.text()};
    },{url:endpoint,csrf,payload});
    const responses=await Promise.all([
      postFromCanvas(a,ownerCsrf,body('Owner Edit')),
      postFromCanvas(b,peerCsrf,body('Peer Edit')),
    ]);
    expect(responses.map(response=>response.status).sort((a,b)=>a-b),
      JSON.stringify(responses)).toEqual([200,409]);
    const saved=await (await owner.request.get(API+'/api/projects/'+id)).json();
    expect(saved.revision).toBe(2);
    expect(['Owner Edit','Peer Edit']).toContain(saved.document.stations[0].name);
    for(const page of [a,b])
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v2 · 远端 v2/))
        .toBeVisible({timeout:20000});
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('rapid native line creation then first station survives a concurrent peer line creation', async ({ browser }) => {
  const owner=await browser.newContext();
  const peer=await browser.newContext();
  try {
    const ownerCsrf=await registerAndLogin(owner,USERS.owner);
    await registerAndLogin(peer,USERS.peer);
    const bootstrap=await owner.newPage();
    await bootstrap.goto(SITE);
    const empty=await bootstrap.evaluate(async ()=>
      (await import('/src/data/storage.ts')).createEmptyProject());
    await bootstrap.close();
    const project=await write(owner,ownerCsrf,'/api/projects',{
      name:'Fast Concurrent First Station',document:empty,
    });
    const id=project.id;
    await write(owner,ownerCsrf,'/api/projects/'+id+'/access-rules',{
      username:USERS.peer,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    const b=await openCanvas(peer,id);
    await Promise.all([
      a.getByRole('button',{name:'＋ 新建线路'}).click(),
      b.getByRole('button',{name:'＋ 新建线路'}).click(),
    ]);
    await a.locator('.line-dialog input').first().fill('Fast A');
    await b.locator('.line-dialog input').first().fill('Fast B');
    await Promise.all([
      a.locator('.line-dialog').getByRole('button',{name:'开始绘制'}).click(),
      b.locator('.line-dialog').getByRole('button',{name:'开始绘制'}).click(),
    ]);
    // Do not wait for either line-create acknowledgement.
    await Promise.all([
      a.locator('#network-canvas').click({position:{x:330,y:85}}),
      b.locator('#network-canvas').click({position:{x:700,y:130}}),
    ]);
    await expect.poll(async ()=>{
      const latest=await (await owner.request.get(API+'/api/projects/'+id)).json();
      return {
        names:latest.document.lines.map(line=>line.name).sort(),
        stations:latest.document.stations.length,
        phases:latest.document.openingPhases.length,
      };
    },{timeout:30000}).toEqual({
      names:['Fast A','Fast B'],stations:2,phases:2,
    });
    for(const page of [a,b]) {
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v5 · 远端 v5/))
        .toBeVisible({timeout:20000});
    }
  } finally {
    await owner.close();
    await peer.close();
  }
});

test('loop closure and independently seeded branch creation converge across browsers', async ({ browser }) => {
  const owner=await browser.newContext();
  const peer=await browser.newContext();
  try {
    const ownerCsrf=await registerAndLogin(owner,USERS.owner);
    const peerCsrf=await registerAndLogin(peer,USERS.peer);
    const bootstrap=await owner.newPage();
    await bootstrap.goto(SITE);
    const seed=await bootstrap.evaluate(async ()=>{
      const project=(await import('/src/data/storage.ts')).createEmptyProject();
      project.stations=[
        {id:'a',name:'A',x:100,y:100,labelOffsetX:14,labelOffsetY:-14},
        {id:'b',name:'B',x:320,y:100,labelOffsetX:14,labelOffsetY:-14},
        {id:'c',name:'C',x:320,y:310,labelOffsetX:14,labelOffsetY:-14},
        {id:'d',name:'D',x:600,y:400,labelOffsetX:14,labelOffsetY:-14},
      ];
      project.lines=[
        {id:'loop-line',name:'Loop',color:'#ff6600',lineOrder:0,
          stationSequence:['a','b','c'],visible:true,locked:false,
          openedAt:project.timeline.currentDate},
        {id:'parent-line',name:'Parent',color:'#3366ff',lineOrder:1,
          stationSequence:['d'],visible:true,locked:false,
          openedAt:project.timeline.currentDate},
      ];
      project.stationLineRelations=[
        {id:'ra',lineId:'loop-line',stationId:'a'},
        {id:'rb',lineId:'loop-line',stationId:'b'},
        {id:'rc',lineId:'loop-line',stationId:'c'},
        {id:'rd',lineId:'parent-line',stationId:'d'},
      ];
      project.geometry.segments=[
        {id:'ab',lineId:'loop-line',fromStationId:'a',toStationId:'b',
          mode:'straight',structureType:'underground',waypoints:[]},
        {id:'bc',lineId:'loop-line',fromStationId:'b',toStationId:'c',
          mode:'straight',structureType:'underground',waypoints:[]},
      ];
      return project;
    });
    await bootstrap.close();
    const created=await write(owner,ownerCsrf,'/api/projects',{
      name:'Loop and Branch Race',document:seed,
    });
    const id=created.id;
    await write(owner,ownerCsrf,'/api/projects/'+id+'/access-rules',{
      username:USERS.peer,action:'edit',allowed:true,
    });
    const a=await openCanvas(owner,id);
    const b=await openCanvas(peer,id);
    const endpoint='/api/projects/'+id+'/operations';
    const phaseDate=seed.timeline.currentDate;
    const operations=await Promise.all([
      write(owner,ownerCsrf,endpoint+'/loop-close',{
        operationId:crypto.randomUUID(),expectedRevision:1,
        lineId:'loop-line',segmentId:'ca',
      }),
      write(peer,peerCsrf,endpoint+'/line-create',{
        operationId:crypto.randomUUID(),expectedRevision:1,
        line:{id:'new-branch',name:'',color:'#3366ff',
          parentLineId:'parent-line',stationSequence:['d'],
          lineBadges:[],lineOrder:2,openedAt:phaseDate,
          closedAt:null,visible:true,locked:false},
        phase:{id:'new-phase',lineId:'new-branch',
          name:'一期',openedAt:phaseDate,segmentIds:[],
          stationRelationIds:['branch-d'],revealStartStationId:'d',
          overriddenSegmentIds:[],overriddenStationRelationIds:[]},
        seedRelation:{id:'branch-d',lineId:'new-branch',stationId:'d',
          openedAt:phaseDate,closedAt:null},
      }),
    ]);
    expect(new Set(operations.map(item=>item.revision))).toEqual(new Set([2,3]));
    await expect.poll(async ()=>{
      const saved=await (await owner.request.get(API+'/api/projects/'+id)).json();
      return {
        revision:saved.revision,
        lines:saved.document.lines.length,
        segments:saved.document.geometry.segments.length,
        branchStart:saved.document.lines.find(line=>line.id==='new-branch')
          ?.stationSequence[0],
        branchRelations:saved.document.stationLineRelations
          .filter(relation=>relation.lineId==='new-branch').length,
      };
    },{timeout:30000}).toEqual({
      revision:3,lines:3,segments:3,branchStart:'d',branchRelations:1,
    });
    for(const page of [a,b]) {
      await expect(page.getByRole('region',{name:'协同工作区'})
        .getByText(/本地基线 v3 · 远端 v3/))
        .toBeVisible({timeout:20000});
    }
  } finally {
    await owner.close();
    await peer.close();
  }
});
