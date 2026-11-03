// HTTP-шар без справжнього сервера: req і res підроблені, сервіси — фейки.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Controller } from '../src/controllers/Controller.js';
import { WeatherController } from '../src/controllers/WeatherController.js';
import { CountriesController } from '../src/controllers/CountriesController.js';
import { TileController } from '../src/controllers/TileController.js';
import { FrameController } from '../src/controllers/FrameController.js';
import { Router } from '../src/http/Router.js';
import { StaticHandler } from '../src/http/StaticHandler.js';
import { WeatherApp } from '../src/http/WeatherApp.js';
import { NotFoundError, RateLimitError, UpstreamError, ValidationError } from '../src/errors.js';
import { fakeReq, fakeRes } from '../testSupport/fakes.js';

const ctxFor = (rawUrl, params = []) => ({ url: new URL(rawUrl, 'http://localhost'), params });

// Глушимо console.error у тестах, де помилка очікувана
function silenceConsole(t) {
  const original = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a);
  t.after(() => { console.error = original; });
  return logged;
}

// ── Controller (шаблонний метод) ──
test('Controller — абстрактний: напряму створити не можна', () => {
  assert.throws(() => new Controller(), TypeError);
});

test('Controller: нащадок без respond() → 500, а не падіння', async (t) => {
  silenceConsole(t);
  class Empty extends Controller {}
  const res = fakeRes();
  await new Empty().handle(fakeReq('/'), res, ctxFor('/'));
  assert.equal(res.status, 500);
  assert.deepEqual(res.json(), { error: 'Внутрішня помилка сервера.' });
});

test('Controller.handle: AppError → статус із класу помилки, текст помилки в JSON', async () => {
  const cases = [
    [new ValidationError('погано'), 400],
    [new NotFoundError('нема'), 404],
    [new RateLimitError('ліміт'), 429],
    [new UpstreamError('збій'), 502],
  ];
  for (const [err, status] of cases) {
    class Failing extends Controller {
      async respond() { throw err; }
    }
    const res = fakeRes();
    await new Failing().handle(fakeReq('/'), res, ctxFor('/'));
    assert.equal(res.status, status);
    assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.deepEqual(res.json(), { error: err.message });
  }
});

test('Controller.handle: невідома помилка → 500 із загальним текстом, деталі лише в лозі', async (t) => {
  const logged = silenceConsole(t);
  class Failing extends Controller {
    async respond() { throw new TypeError('секретна деталь'); }
  }
  const res = fakeRes();
  await new Failing().handle(fakeReq('/'), res, ctxFor('/'));
  assert.equal(res.status, 500);
  assert.ok(!res.body.includes('секретна деталь'));
  assert.equal(logged.length, 1);
});

// ── Конкретні контролери ──
test('WeatherController: city і country з query передаються сервісу, відповідь = JSON обʼєкта (через toJSON)', async () => {
  const args = [];
  const weatherService = {
    getWeather: async (...a) => (args.push(a), { toJSON: () => ({ city: 'Kyiv' }) }),
  };
  const res = fakeRes();
  await new WeatherController({ weatherService }).handle(fakeReq('/'), res, ctxFor('/api/weather?city=Kyiv&country=UA'));
  assert.deepEqual(args[0], ['Kyiv', 'UA']);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), { city: 'Kyiv' });
});

test('WeatherController: без параметрів сервіс отримує null, а його ValidationError → 400', async () => {
  const weatherService = {
    getWeather: async (city) => {
      assert.equal(city, null);
      throw new ValidationError('Вкажи назву міста');
    },
  };
  const res = fakeRes();
  await new WeatherController({ weatherService }).handle(fakeReq('/'), res, ctxFor('/api/weather'));
  assert.equal(res.status, 400);
});

test('CountriesController: віддає список країн', async () => {
  const weatherService = { getCountries: () => [{ code: 'UA', name: 'Україна' }] };
  const res = fakeRes();
  await new CountriesController({ weatherService }).handle(fakeReq('/'), res, ctxFor('/api/countries'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), [{ code: 'UA', name: 'Україна' }]);
});

test('TileController.ROUTE: ловить лише правильні шляхи тайлів і віддає групи', () => {
  assert.deepEqual('/api/tiles/wind_new/3/4/5.png'.match(TileController.ROUTE).slice(1), ['wind_new', '3', '4', '5']);
  assert.equal(TileController.ROUTE.test('/api/tiles/wind_new/3/4/5.jpg'), false);
  assert.equal(TileController.ROUTE.test('/api/tiles/../x/3/4/5.png'), false);
});

test('TileController: PNG із заголовками Content-Type і Cache-Control 10 хв', async () => {
  const seen = [];
  const weatherService = { getMapTile: async (p) => (seen.push(p), Buffer.from('PNG')) };
  const res = fakeRes();
  await new TileController({ weatherService }).handle(fakeReq('/'), res, ctxFor('/', ['wind_new', '3', '4', '5']));
  assert.deepEqual(seen[0], { layer: 'wind_new', z: '3', x: '4', y: '5' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' });
  assert.equal(res.body.toString(), 'PNG');
});

test('TileController: помилка сервісу → JSON із відповідним статусом', async () => {
  const weatherService = { getMapTile: async () => { throw new NotFoundError('Тайл не знайдено.'); } };
  const res = fakeRes();
  await new TileController({ weatherService }).handle(fakeReq('/'), res, ctxFor('/', ['wind_new', '1', '0', '0']));
  assert.equal(res.status, 404);
  assert.deepEqual(res.json(), { error: 'Тайл не знайдено.' });
});

test('FrameController: передає hour функції кадру й віддає JSON (поліморфно, через toJSON)', async () => {
  const hours = [];
  const controller = new FrameController(async (h) => (hours.push(h), { toJSON: () => ({ hour: 7 }) }));
  const res = fakeRes();
  await controller.handle(fakeReq('/'), res, ctxFor('/api/wind?hour=7'));
  assert.deepEqual(hours, ['7']);
  assert.deepEqual(res.json(), { hour: 7 });

  await controller.handle(fakeReq('/'), fakeRes(), ctxFor('/api/wind'));
  assert.equal(hours[1], null); // без параметра hour
});

test('FrameController: ValidationError функції кадру → 400', async () => {
  const controller = new FrameController(async () => { throw new ValidationError('Некоректна година прогнозу.'); });
  const res = fakeRes();
  await controller.handle(fakeReq('/'), res, ctxFor('/api/wind?hour=abc'));
  assert.equal(res.status, 400);
});

// ── Router ──
const recorder = (name, log) => ({ handle: async (req, res, ctx) => { log.push({ name, ctx }); res.writeHead(200).end(name); } });

test('Router: точний шлях, RegExp з групами, інакше — fallback', async () => {
  const log = [];
  const router = new Router({ fallback: recorder('fallback', log) })
    .get('/api/a', recorder('a', log))
    .get(/^\/api\/t\/(\d+)\/(\w+)$/, recorder('t', log));

  await router.handle(fakeReq('/api/a?x=1'), fakeRes());
  await router.handle(fakeReq('/api/t/12/ab'), fakeRes());
  await router.handle(fakeReq('/index.html'), fakeRes());

  assert.deepEqual(log.map((e) => e.name), ['a', 't', 'fallback']);
  assert.equal(log[0].ctx.url.searchParams.get('x'), '1');
  assert.deepEqual(log[1].ctx.params, ['12', 'ab']);
  assert.deepEqual(log[2].ctx.params, []);
});

test('Router.get повертає this (ланцюжок) і шукає маршрути за порядком додавання', async () => {
  const log = [];
  const router = new Router({ fallback: recorder('fallback', log) });
  assert.equal(router.get('/x', recorder('first', log)), router);
  router.get('/x', recorder('second', log));
  await router.handle(fakeReq('/x'), fakeRes());
  assert.deepEqual(log.map((e) => e.name), ['first']);
});

test('Router: метод не GET → 405, обробник не викликається', async () => {
  const log = [];
  const router = new Router({ fallback: recorder('fallback', log) }).get('/api/a', recorder('a', log));
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = fakeRes();
    await router.handle(fakeReq('/api/a', method), res);
    assert.equal(res.status, 405);
  }
  assert.equal(log.length, 0);
});

test('Router: некоректний URL (дивний Host) → 400, а не падіння процесу', async (t) => {
  const logged = silenceConsole(t);
  const router = new Router({ fallback: recorder('fallback', []) });
  const res = fakeRes();
  await router.handle(fakeReq('/', 'GET', 'bad host'), res);
  assert.equal(res.status, 400);
  assert.ok(res.ended);
  assert.equal(logged.length, 1);
});

test('Router: працює з будь-яким обʼєктом, що має handle (качина типізація)', async () => {
  const res = fakeRes();
  const router = new Router({ fallback: { handle: async (req, r) => r.writeHead(204).end() } });
  await router.handle(fakeReq('/anything'), res);
  assert.equal(res.status, 204);
});

// ── StaticHandler ──
function makePublicDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-public-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'data.bin'), 'x');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('StaticHandler: / → index.html, правильні Content-Type за розширенням', async (t) => {
  const handler = new StaticHandler(makePublicDir(t));
  const cases = [
    ['/', 'text/html; charset=utf-8', '<h1>hi</h1>'],
    ['/app.js', 'text/javascript; charset=utf-8', 'console.log(1)'],
    ['/style.css', 'text/css; charset=utf-8', 'body{}'],
    ['/data.bin', 'application/octet-stream', 'x'],
  ];
  for (const [url, type, body] of cases) {
    const res = fakeRes();
    await handler.handle(fakeReq(url), res, ctxFor(url));
    assert.equal(res.status, 200, url);
    assert.equal(res.headers['Content-Type'], type);
    assert.equal(res.body.toString(), body);
  }
});

test('StaticHandler: файлу немає → 404', async (t) => {
  const res = fakeRes();
  await new StaticHandler(makePublicDir(t)).handle(fakeReq('/nope.js'), res, ctxFor('/nope.js'));
  assert.equal(res.status, 404);
});

test('StaticHandler: шлях із ../ (закодований слеш) виходить за public → 403', async (t) => {
  const handler = new StaticHandler(makePublicDir(t));
  for (const url of ['/..%2f..%2fetc/passwd', '/..%2fsecret.txt']) {
    const res = fakeRes();
    await handler.handle(fakeReq(url), res, ctxFor(url));
    assert.equal(res.status, 403, url);
  }
});

test('StaticHandler: %2e%2e/ URL нормалізує сам ще до обробника → файл не віддається (404)', async (t) => {
  const res = fakeRes();
  await new StaticHandler(makePublicDir(t)).handle(fakeReq('/'), res, ctxFor('/%2e%2e/secret.txt'));
  assert.equal(res.status, 404);
});

test('StaticHandler: некоректне %-кодування → 400 (раніше могло впасти процес)', async (t) => {
  const res = fakeRes();
  await new StaticHandler(makePublicDir(t)).handle(fakeReq('/%zz'), res, ctxFor('/%zz'));
  assert.equal(res.status, 400);
});

test('StaticHandler: папка замість файлу → 404', async (t) => {
  const dir = makePublicDir(t);
  fs.mkdirSync(path.join(dir, 'sub'));
  const res = fakeRes();
  await new StaticHandler(dir).handle(fakeReq('/sub'), res, ctxFor('/sub'));
  assert.equal(res.status, 404);
});

// ── Router + StaticHandler разом ──
test('Router → StaticHandler: /%zz через маршрутизатор дає 400, а /..%2f — 403, без падіння', async (t) => {
  const router = new Router({ fallback: new StaticHandler(makePublicDir(t)) });
  const bad = fakeRes();
  await router.handle(fakeReq('/%zz'), bad);
  assert.equal(bad.status, 400);

  const encoded = fakeRes();
  await router.handle(fakeReq('/..%2fx'), encoded);
  assert.equal(encoded.status, 403);
});

// ── WeatherApp ──
test('WeatherApp: піднімає справжній сервер на вільному порту й віддає запити роутеру', async (t) => {
  const router = new Router({ fallback: { handle: async (req, res) => res.writeHead(200).end('ok') } });
  const server = new WeatherApp({ router }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/anything`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  const post = await fetch(`http://127.0.0.1:${port}/anything`, { method: 'POST' });
  assert.equal(post.status, 405);
});
