// Запуск: npm test. Сервіс сітки (вітер і опади) тестуємо без мережі: client — фейк, час і «сон» — підставні.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GridService } from '../src/services/GridService.js';
import { Grid } from '../src/domain/Grid.js';
import { WindFrame, PrecipitationFrame } from '../src/domain/Frame.js';
import { UpstreamError, ValidationError } from '../src/errors.js';

const START = 1_700_000_000 - (1_700_000_000 % 3600); // початок «поточної» години, UNIX-секунди
const HOURS = 72;
const GRID = Grid.EUROPE;

// Фейковий Open-Meteo: для кожної точки — стабільний вітер (3 м/с із заходу).
// Опади: у годину i в точці p — (p % 5) / 2 мм, тож значення залежать і від точки, і від години (i = 0 → 0 мм).
function fakeClient() {
  const calls = [];
  let offset = 0; // скільки точок уже віддано в попередніх порціях (щоб p був глобальним індексом)
  return {
    calls,
    async getGrid(points, hours) {
      calls.push(points.length);
      const first = offset;
      offset = (offset + points.length) % GRID.pointCount;
      return points.map((_, k) => ({
        hourly: {
          time: Array.from({ length: hours }, (_, i) => START + i * 3600),
          wind_speed_10m: Array(hours).fill(3),
          wind_direction_10m: Array(hours).fill(270),
          precipitation: Array.from({ length: hours }, (_, i) => (i === 0 ? 0 : ((first + k) % 5) / 2)),
        },
      }));
    },
  };
}

const makeService = (client, nowSec = START) =>
  new GridService({ client, now: () => nowSec * 1000, sleep: async () => {} });

const isValidation = (e) => e instanceof ValidationError && e.status === 400;

test('getWindFrame: WindFrame із U/V потрібної довжини, рахує, скільки годин ще лишилось', async () => {
  const frame = await makeService(fakeClient()).getWindFrame('0');
  assert.ok(frame instanceof WindFrame);
  assert.equal(frame.data[0].data.length, GRID.pointCount);
  assert.equal(frame.data[0].data[0], 3); // західний вітер 3 м/с → u = 3
  assert.equal(frame.data[1].data[0], 0); // v = 0 (округлено до 2 знаків)
  assert.equal(frame.hours, HOURS);
  assert.equal(frame.time, new Date(START * 1000).toISOString());
  assert.equal(frame.data[0].header.refTime, frame.time);
});

test('getPrecipitationFrame: плоский масив по сітці з описом сітки', async () => {
  const frame = await makeService(fakeClient()).getPrecipitationFrame(1);
  assert.ok(frame instanceof PrecipitationFrame);
  assert.equal(frame.values.length, GRID.pointCount);
  assert.deepEqual(frame.grid, GRID.describe());
  // значення залежить від ГЛОБАЛЬНОГО індексу точки, тож порядок після склеювання порцій збережено
  assert.deepEqual(frame.values.slice(0, 6), [0, 0.5, 1, 1.5, 2, 0]);
  assert.equal(frame.hour, 1);
  assert.equal(frame.time, new Date((START + 3600) * 1000).toISOString());
});

test('getPrecipitationFrame: година 0 без опадів → усі нулі; відсутні значення (null) теж 0', async () => {
  const client = fakeClient();
  const original = client.getGrid;
  client.getGrid = async (...a) => {
    const res = await original(...a);
    res[0].hourly.precipitation[2] = null; // Open-Meteo може віддати null
    return res;
  };
  const service = makeService(client);
  const zero = await service.getPrecipitationFrame(0);
  assert.ok(zero.values.every((x) => x === 0));
  assert.equal((await service.getPrecipitationFrame(2)).values[0], 0);
});

test('getWindFrame: null швидкості й напрямку → штиль (0)', async () => {
  const client = fakeClient();
  const original = client.getGrid;
  client.getGrid = async (...a) => {
    const res = await original(...a);
    res[0].hourly.wind_speed_10m[1] = null;
    res[0].hourly.wind_direction_10m[1] = null;
    return res;
  };
  const frame = await makeService(client).getWindFrame(1);
  assert.ok(frame.data[0].data[0] === 0); // === не розрізняє 0 і -0 (у JSON обидва дають 0)
  assert.ok(frame.data[1].data[0] === 0);
});

test('сітка: ділить на порції й кешує — і вітер, і опади беруться з ОДНОГО набору запитів', async () => {
  const client = fakeClient();
  const service = makeService(client);
  await service.getWindFrame(0);
  await service.getPrecipitationFrame(5);
  assert.equal(client.calls.reduce((a, b) => a + b, 0), GRID.pointCount); // не 2 × 493
  assert.ok(client.calls.every((n) => n <= GridService.CHUNK_SIZE));
  assert.deepEqual(client.calls, [100, 100, 100, 100, 93]);
  const total = client.calls.length;
  await service.getWindFrame(10);
  await service.getPrecipitationFrame(10);
  assert.equal(client.calls.length, total); // кеш
});

test('сітка: між порціями робиться пауза (sleep), перед першою — ні', async () => {
  const sleeps = [];
  const service = new GridService({
    client: fakeClient(),
    now: () => START * 1000,
    sleep: async (ms) => { sleeps.push(ms); },
    pauseMs: 1234,
  });
  await service.getWindFrame(0);
  assert.deepEqual(sleeps, [1234, 1234, 1234, 1234]); // 5 порцій → 4 паузи
});

test('getWindFrame: одночасні запити ділять один виклик назовні', async () => {
  const client = fakeClient();
  const service = makeService(client);
  await Promise.all([service.getWindFrame(0), service.getPrecipitationFrame(1), service.getWindFrame(2)]);
  assert.equal(client.calls.reduce((a, b) => a + b, 0), GRID.pointCount);
});

test('кеш застарів (TTL 3 год) — наступний запит завантажує сітку заново', async () => {
  const client = fakeClient();
  let nowSec = START;
  const service = new GridService({ client, now: () => nowSec * 1000, sleep: async () => {} });
  await service.getWindFrame(0);
  const first = client.calls.length;
  nowSec = START + 3 * 3600 + 1;
  await service.getWindFrame(0);
  assert.equal(client.calls.length, first * 2);
});

test('година за межами прогнозу або некоректна → ValidationError 400 (і для вітру, і для опадів)', async () => {
  const service = makeService(fakeClient());
  for (const bad of [HOURS, -1, 'abc', 1.5]) {
    await assert.rejects(() => service.getWindFrame(bad), isValidation);
    await assert.rejects(() => service.getPrecipitationFrame(bad), isValidation);
  }
});

test('година не задана (null) → 0', async () => {
  assert.equal((await makeService(fakeClient()).getWindFrame(null)).hour, 0);
});

test('Open-Meteo впав, а кеш є — віддає старий кеш і зсуває початок на 4 години', async () => {
  const client = fakeClient();
  let nowSec = START;
  const service = new GridService({ client, now: () => nowSec * 1000, sleep: async () => {} });
  await service.getWindFrame(0);

  nowSec = START + 4 * 3600; // кеш застарів
  client.getGrid = async () => { throw new UpstreamError('впав'); };
  const frame = await service.getPrecipitationFrame(0); // не кидає, бо є старі дані
  assert.equal(frame.hours, HOURS - 4);
});

test('після невдалого оновлення повторна спроба лише через 10 хвилин', async () => {
  const client = fakeClient();
  let nowSec = START;
  const service = new GridService({ client, now: () => nowSec * 1000, sleep: async () => {} });
  await service.getWindFrame(0);

  nowSec = START + 4 * 3600;
  let attempts = 0;
  client.getGrid = async () => { attempts++; throw new UpstreamError('впав'); };
  await service.getWindFrame(0);
  assert.equal(attempts, 1);
  nowSec += 5 * 60; // через 5 хв — ще не пробуємо
  await service.getWindFrame(0);
  assert.equal(attempts, 1);
  nowSec += 6 * 60; // разом 11 хв — пробуємо знову
  await service.getWindFrame(0);
  assert.equal(attempts, 2);
});

test('Open-Meteo впав, а кешу ще немає → помилка проходить (502)', async () => {
  const client = { getGrid: async () => { throw new UpstreamError('впав'); } };
  await assert.rejects(() => makeService(client).getWindFrame(0), (e) => e instanceof UpstreamError && e.status === 502);
});

test('неповна відповідь Open-Meteo (менше точок, ніж просили) → UpstreamError', async () => {
  const client = { getGrid: async () => [] };
  await assert.rejects(() => makeService(client).getWindFrame(0), (e) => e instanceof UpstreamError && /неповні/.test(e.message));
});

test('власна маленька сітка: сервіс бере Grid ззовні (ін’єкція залежностей)', async () => {
  const grid = new Grid({ la1: 10, la2: 0, lo1: 0, lo2: 10, step: 10 }); // 2 × 2 = 4 точки
  const client = fakeClient();
  const service = new GridService({ client, grid, now: () => START * 1000, sleep: async () => {} });
  const frame = await service.getPrecipitationFrame(1);
  assert.equal(frame.values.length, 4);
  assert.equal(frame.grid.nx, 2);
  assert.deepEqual(client.calls, [4]);
});
