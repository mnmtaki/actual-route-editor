import { test, expect, request } from '@playwright/test';

const API = 'http://127.0.0.1:8080';
const SITE = 'http://127.0.0.1:5173';
const suffix = () => Math.random().toString(36).slice(2, 11);
const USERS = { owner: 'e2eOwner' + suffix(), peer: 'e2eEditor' + suffix() };
const PASSWORD = 'browser-test-password-123';
test.beforeAll(async () => {
  const api = await request.newContext();
  try {
    for (const username of Object.values(USERS)) {
      const response = await api.post(API + '/api/auth/register', {
        data: { username, password: PASSWORD },
      });
      expect(response.status(), await response.text()).toBe(201);
    }
  } finally {
    await api.dispose();
  }
});
async function registerAndLogin(context, username) {
  const logged = await context.request.post(API + '/api/auth/login', {
    data: { username, password: PASSWORD },
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
