// Запуск: npm test. Сервіс вітру тестуємо без мережі: client — фейк, час і «сон» — підставні.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindService, gridPoints, gridSize, toUV, buildVelocityData } from '../src/services/windService.js';
import { AppError } from '../src/errors.js';

const START = 1_700_000_000 - (1_700_000_000 % 3600); // початок «поточної» години, UNIX-секунди
const HOURS = 72;

// Фейковий Open-Meteo: для кожної точки — стабільний вітер (3 м/с із заходу)
function fakeClient() {
  const calls = [];
  return {
    calls,
    async getWind(points, hours) {
      calls.push(points.length);
      return points.map(() => ({
        hourly: {
          time: Array.from({ length: hours }, (_, i) => START + i * 3600),
          wind_speed_10m: Array(hours).fill(3),
          wind_direction_10m: Array(hours).fill(270),
        },
      }));
    },
  };
}

const makeService = (client, nowSec = START) =>
  createWindService({ client, now: () => nowSec * 1000, sleep: async () => {} });

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

test('getWindFrame: ділить сітку на порції і кешує — другий запит не йде в мережу', async () => {
  const client = fakeClient();
  const service = makeService(client);
  await service.getWindFrame(0);
  await service.getWindFrame(5);
  const { nx, ny } = gridSize();
  assert.equal(client.calls.reduce((a, b) => a + b, 0), nx * ny);
  assert.ok(client.calls.every((n) => n <= 100));
  const total = client.calls.length;
  await service.getWindFrame(10);
  assert.equal(client.calls.length, total); // кеш
});

test('getWindFrame: одночасні запити ділять один виклик назовні', async () => {
  const client = fakeClient();
  const service = makeService(client);
  await Promise.all([service.getWindFrame(0), service.getWindFrame(1), service.getWindFrame(2)]);
  const { nx, ny } = gridSize();
  assert.equal(client.calls.reduce((a, b) => a + b, 0), nx * ny);
});

test('getWindFrame: година за межами прогнозу або некоректна → AppError 400', async () => {
  const service = makeService(fakeClient());
  for (const bad of [HOURS, -1, 'abc', 1.5]) {
    await assert.rejects(() => service.getWindFrame(bad), (e) => e instanceof AppError && e.status === 400);
  }
});

test('getWindFrame: якщо Open-Meteo впав, а кеш є — віддає старий кеш', async () => {
  const client = fakeClient();
  let nowSec = START;
  const service = createWindService({ client, now: () => nowSec * 1000, sleep: async () => {} });
  await service.getWindFrame(0);

  nowSec = START + 4 * 3600; // кеш застарів (TTL 3 год)
  client.getWind = async () => { throw new AppError(502, 'впав'); };
  const frame = await service.getWindFrame(0); // не кидає, бо є старі дані
  assert.equal(frame.hours, HOURS - 4); // і правильно зсунув початок на 4 години
});

test('getWindFrame: Open-Meteo впав, а кешу ще немає → помилка', async () => {
  const client = { getWind: async () => { throw new AppError(502, 'впав'); } };
  const service = makeService(client);
  await assert.rejects(() => service.getWindFrame(0), (e) => e instanceof AppError && e.status === 502);
});
