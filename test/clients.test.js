// Клієнти тестуємо з підробленим fetch: перевіряємо URL, які посилаємо, і помилки, які повертаємо за статусами.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/clients/ApiClient.js';
import { OpenWeatherClient } from '../src/clients/OpenWeatherClient.js';
import { OpenMeteoClient } from '../src/clients/OpenMeteoClient.js';
import { Coordinate } from '../src/domain/Coordinate.js';
import { CityQuery } from '../src/domain/CityQuery.js';
import { TileRequest } from '../src/domain/TileRequest.js';
import { NotFoundError, RateLimitError, UpstreamError } from '../src/errors.js';
import { fakeFetch } from '../testSupport/fakes.js';

// ── ApiClient (абстрактний) ──
test('ApiClient — абстрактний: напряму створити не можна', () => {
  assert.throws(() => new ApiClient(), TypeError);
});

test('ApiClient: нащадок без serviceName кидає зрозумілу помилку', () => {
  class Broken extends ApiClient {}
  assert.throws(() => new Broken().serviceName, /must define serviceName/);
});

test('ApiClient.errorForStatus: базові відповіді 404 / 429 / інше', () => {
  class Test extends ApiClient {
    get serviceName() { return 'Тест'; }
  }
  const c = new Test();
  const nf = c.errorForStatus(404, { notFoundMessage: 'Нема' });
  assert.ok(nf instanceof NotFoundError);
  assert.equal(nf.message, 'Нема');
  assert.equal(c.errorForStatus(404).message, 'Не знайдено.');
  assert.ok(c.errorForStatus(429) instanceof RateLimitError);
  const up = c.errorForStatus(500);
  assert.ok(up instanceof UpstreamError);
  assert.match(up.message, /Тест/);
});

test('ApiClient.request: мережева помилка → UpstreamError із cause', async () => {
  class Test extends ApiClient {
    get serviceName() { return 'Тест'; }
  }
  const boom = new TypeError('fetch failed');
  const c = new Test({ fetchFn: fakeFetch({ error: boom }) });
  await assert.rejects(
    () => c.getJson('http://x'),
    (e) => e instanceof UpstreamError && e.status === 502 && e.cause === boom && /Тест/.test(e.message),
  );
});

// ── OpenWeatherClient ──
const query = new CityQuery('Kyiv', 'UA');
const newOwm = (fetchOptions) => {
  const fetchFn = fakeFetch(fetchOptions);
  return { client: new OpenWeatherClient({ apiKey: 'SECRET', fetchFn }), fetchFn };
};

test('OpenWeatherClient.getCurrent: URL із містом, країною, ключем, metric, ua', async () => {
  const { client, fetchFn } = newOwm({ json: { name: 'Kyiv' } });
  const body = await client.getCurrent(query);
  assert.deepEqual(body, { name: 'Kyiv' });
  const url = new URL(fetchFn.calls[0]);
  assert.equal(url.pathname, '/data/2.5/weather');
  assert.equal(url.searchParams.get('q'), 'Kyiv,UA');
  assert.equal(url.searchParams.get('appid'), 'SECRET');
  assert.equal(url.searchParams.get('units'), 'metric');
  assert.equal(url.searchParams.get('lang'), 'ua');
});

test('OpenWeatherClient.getForecast: інший ендпоінт; без країни q = лише місто', async () => {
  const { client, fetchFn } = newOwm();
  await client.getForecast(new CityQuery('Lviv', ''));
  const url = new URL(fetchFn.calls[0]);
  assert.equal(url.pathname, '/data/2.5/forecast');
  assert.equal(url.searchParams.get('q'), 'Lviv');
});

test('OpenWeatherClient: помилки за статусами (401 / 404 / 429 / 5xx)', async () => {
  const expectations = [
    [401, UpstreamError, /API-ключ недійсний/],
    [404, NotFoundError, /Місто «Kyiv» не знайдено \(UA\)\./],
    [429, RateLimitError, /ліміт/],
    [500, UpstreamError, /Помилка сервісу погоди/],
    [503, UpstreamError, /Помилка сервісу погоди/],
  ];
  for (const [status, Cls, re] of expectations) {
    const { client } = newOwm({ status });
    await assert.rejects(
      () => client.getCurrent(query),
      (e) => e instanceof Cls && re.test(e.message),
      `статус ${status}`,
    );
  }
});

test('OpenWeatherClient: 404 без країни — повідомлення без дужок', async () => {
  const { client } = newOwm({ status: 404 });
  await assert.rejects(() => client.getCurrent(new CityQuery('Nowhere', '')), (e) => e.message === 'Місто «Nowhere» не знайдено.');
});

test('OpenWeatherClient: мережа впала → UpstreamError з назвою сервісу', async () => {
  const { client } = newOwm({ error: new Error('offline') });
  await assert.rejects(() => client.getCurrent(query), (e) => e instanceof UpstreamError && /OpenWeatherMap/.test(e.message));
});

test('OpenWeatherClient.getMapTile: URL тайла з ключем, повертає Buffer; 404 → «Тайл не знайдено»', async () => {
  const { client, fetchFn } = newOwm({ bytes: new Uint8Array([137, 80, 78, 71]) });
  const png = await client.getMapTile(new TileRequest('wind_new', 3, 4, 5));
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png], [137, 80, 78, 71]);
  const url = new URL(fetchFn.calls[0]);
  assert.equal(url.hostname, 'tile.openweathermap.org');
  assert.equal(url.pathname, '/map/wind_new/3/4/5.png');
  assert.equal(url.searchParams.get('appid'), 'SECRET');

  const { client: missing } = newOwm({ status: 404 });
  await assert.rejects(() => missing.getMapTile(new TileRequest('wind_new', 3, 4, 5)), (e) => e instanceof NotFoundError && e.message === 'Тайл не знайдено.');
});

test('OpenWeatherClient: ключ приватний — його не видно у властивостях обʼєкта', () => {
  const { client } = newOwm();
  assert.ok(!JSON.stringify(client).includes('SECRET'));
  assert.ok(!Object.values(client).includes('SECRET'));
});

// ── OpenMeteoClient ──
const points = [new Coordinate(50, 30), new Coordinate(51, 31)];

test('OpenMeteoClient.getGrid: усі точки в одному запиті, потрібні змінні й параметри', async () => {
  const fetchFn = fakeFetch({ json: [{ hourly: {} }, { hourly: {} }] });
  const client = new OpenMeteoClient({ fetchFn });
  const result = await client.getGrid(points, 72);
  assert.equal(result.length, 2);
  const url = new URL(fetchFn.calls[0]);
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '50,51');
  assert.equal(url.searchParams.get('longitude'), '30,31');
  assert.equal(url.searchParams.get('hourly'), 'wind_speed_10m,wind_direction_10m,precipitation');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(url.searchParams.get('forecast_hours'), '72');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('cell_selection'), 'nearest');
});

test('OpenMeteoClient.getGrid: для однієї точки API повертає обʼєкт — клієнт загортає в масив', async () => {
  const client = new OpenMeteoClient({ fetchFn: fakeFetch({ json: { hourly: { time: [1] } } }) });
  const result = await client.getGrid([points[0]], 1);
  assert.ok(Array.isArray(result));
  assert.deepEqual(result, [{ hourly: { time: [1] } }]);
});

test('OpenMeteoClient: 429 → RateLimitError, інші статуси → UpstreamError, мережа → UpstreamError', async () => {
  await assert.rejects(
    () => new OpenMeteoClient({ fetchFn: fakeFetch({ status: 429 }) }).getGrid(points, 1),
    (e) => e instanceof RateLimitError && /Open-Meteo/.test(e.message),
  );
  for (const status of [400, 404, 500, 502]) {
    await assert.rejects(
      () => new OpenMeteoClient({ fetchFn: fakeFetch({ status }) }).getGrid(points, 1),
      (e) => e instanceof UpstreamError && /Open-Meteo/.test(e.message),
      `статус ${status}`,
    );
  }
  await assert.rejects(
    () => new OpenMeteoClient({ fetchFn: fakeFetch({ error: new Error('down') }) }).getGrid(points, 1),
    (e) => e instanceof UpstreamError && /Open-Meteo/.test(e.message),
  );
});

test('поліморфізм: однаковий виклик errorForStatus(429) дає різні тексти у двох клієнтів', () => {
  const owm = new OpenWeatherClient({ apiKey: 'k' });
  const meteo = new OpenMeteoClient();
  assert.notEqual(owm.errorForStatus(429).message, meteo.errorForStatus(429).message);
  assert.ok(owm instanceof ApiClient && meteo instanceof ApiClient);
});
