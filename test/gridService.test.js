// Запуск: npm test. Сервіс сітки (вітер і опади) тестуємо без мережі: client — фейк, час і «сон» — підставні.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridService, gridPoints, gridSize, gridInfo, toUV, buildVelocityData } from '../src/services/gridService.js';
import { AppError } from '../src/errors.js';

const START = 1_700_000_000 - (1_700_000_000 % 3600); // початок «поточної» години, UNIX-секунди
const HOURS = 72;

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
      offset = (offset + points.length) % gridPoints().length;
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
  createGridService({ client, now: () => nowSec * 1000, sleep: async () => {} });

test('toUV: західний вітер дме на схід (u>0), північний — на південь (v<0)', () => {
  const west = toUV(5, 270);
  assert.ok(Math.abs(west.u - 5) < 1e-9 && Math.abs(west.v) < 1e-9);
  const north = toUV(5, 0);
  assert.ok(Math.abs(north.u) < 1e-9 && Math.abs(north.v + 5) < 1e-9);
});

test('gridPoints: починається з північного заходу й іде рядками, кількість = nx × ny', () => {
  const pts = gridPoints();
  const { nx, ny } = gridSize();
  assert.equal(pts.length, nx * ny);
  assert.deepEqual(pts[0], { lat: 72.5, lon: -25 });
  assert.deepEqual(pts[1], { lat: 72.5, lon: -22.5 }); // далі на схід
  assert.deepEqual(pts[nx], { lat: 70, lon: -25 }); // наступний рядок — південніше
});

test('buildVelocityData: два обʼєкти U/V із заголовком, який чекає leaflet-velocity', () => {
  const { nx, ny } = gridSize();
  const n = nx * ny;
  const [u, v] = buildVelocityData(Array(n).fill(1), Array(n).fill(2), '2026-01-01T00:00:00.000Z');
  assert.equal(u.header.parameterNumber, 2);
  assert.equal(v.header.parameterNumber, 3);
  assert.equal(u.header.nx, nx);
  assert.equal(u.header.la1, 72.5);
  assert.equal(u.data.length, n);
});

test('getWindFrame: віддає U/V потрібної довжини й рахує, скільки годин ще лишилось', async () => {
  const service = makeService(fakeClient());
  const frame = await service.getWindFrame('0');
  const { nx, ny } = gridSize();
  assert.equal(frame.data[0].data.length, nx * ny);
  assert.equal(frame.data[0].data[0], 3); // західний вітер 3 м/с → u = 3
  assert.equal(frame.hours, HOURS);
  assert.equal(frame.time, new Date(START * 1000).toISOString());
});

test('getPrecipitationFrame: плоский масив по сітці з описом сітки', async () => {
  const service = makeService(fakeClient());
  const frame = await service.getPrecipitationFrame(1);
  const { nx, ny } = gridSize();
  assert.equal(frame.values.length, nx * ny);
  assert.deepEqual(frame.grid, gridInfo());
  assert.equal(frame.grid.la1, 72.5); // перше значення — північно-західний кут
  // значення залежить від ГЛОБАЛЬНОГО індексу точки, тож порядок після склеювання порцій збережено
  assert.deepEqual(frame.values.slice(0, 6), [0, 0.5, 1, 1.5, 2, 0]);
  assert.equal(frame.hour, 1);
  assert.equal(frame.time, new Date((START + 3600) * 1000).toISOString());
});

test('getPrecipitationFrame: година 0 без опадів → усі нулі; відсутні значення теж 0', async () => {
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
  const withNull = await service.getPrecipitationFrame(2);
  assert.equal(withNull.values[0], 0);
});

test('сітка: ділить на порції й кешує — і вітер, і опади беруться з ОДНОГО набору запитів', async () => {
  const client = fakeClient();
  const service = makeService(client);
  await service.getWindFrame(0);
  await service.getPrecipitationFrame(5);
  const { nx, ny } = gridSize();
  assert.equal(client.calls.reduce((a, b) => a + b, 0), nx * ny); // не 2 × nx × ny
  assert.ok(client.calls.every((n) => n <= 100));
  const total = client.calls.length;
  await service.getWindFrame(10);
  await service.getPrecipitationFrame(10);
  assert.equal(client.calls.length, total); // кеш
});

test('getWindFrame: одночасні запити ділять один виклик назовні', async () => {
  const client = fakeClient();
  const service = makeService(client);
  await Promise.all([service.getWindFrame(0), service.getPrecipitationFrame(1), service.getWindFrame(2)]);
  const { nx, ny } = gridSize();
  assert.equal(client.calls.reduce((a, b) => a + b, 0), nx * ny);
});

test('година за межами прогнозу або некоректна → AppError 400 (і для вітру, і для опадів)', async () => {
  const service = makeService(fakeClient());
  for (const bad of [HOURS, -1, 'abc', 1.5]) {
    await assert.rejects(() => service.getWindFrame(bad), (e) => e instanceof AppError && e.status === 400);
    await assert.rejects(() => service.getPrecipitationFrame(bad), (e) => e instanceof AppError && e.status === 400);
  }
});

test('Open-Meteo впав, а кеш є — віддає старий кеш', async () => {
  const client = fakeClient();
  let nowSec = START;
  const service = createGridService({ client, now: () => nowSec * 1000, sleep: async () => {} });
  await service.getWindFrame(0);

  nowSec = START + 4 * 3600; // кеш застарів (TTL 3 год)
  client.getGrid = async () => { throw new AppError(502, 'впав'); };
  const frame = await service.getPrecipitationFrame(0); // не кидає, бо є старі дані
  assert.equal(frame.hours, HOURS - 4); // і правильно зсунув початок на 4 години
});

test('Open-Meteo впав, а кешу ще немає → помилка', async () => {
  const client = { getGrid: async () => { throw new AppError(502, 'впав'); } };
  const service = makeService(client);
  await assert.rejects(() => service.getWindFrame(0), (e) => e instanceof AppError && e.status === 502);
});
