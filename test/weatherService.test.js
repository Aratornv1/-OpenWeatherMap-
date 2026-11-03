// Запуск: npm test  (вбудований node:test, без залежностей)
// Бачиш перевагу шарів: сервіс тестуємо БЕЗ мережі, підставивши фейковий client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService, buildDailyForecast, parseTile } from '../src/services/weatherService.js';
import { AppError } from '../src/errors.js';

const NOW = Date.parse('2026-11-02T10:00:00Z');

// запис прогнозу: дата-час UTC, температура
const item = (iso, temp, icon = '10n') => ({
  dt: Date.parse(iso) / 1000,
  main: { temp, humidity: 80 },
  weather: [{ icon, description: 'дощ' }],
});

const forecast = {
  city: { timezone: 0 },
  list: [
    item('2026-11-02T15:00:00Z', 9), // сьогодні — має бути відкинуто
    item('2026-11-03T03:00:00Z', 2),
    item('2026-11-03T12:00:00Z', 8, '01d'),
    item('2026-11-04T12:00:00Z', 5),
    item('2026-11-05T12:00:00Z', 6),
    item('2026-11-06T12:00:00Z', 7), // 4-й день — відкидаємо
  ],
};

test('buildDailyForecast: пропускає сьогодні й повертає рівно 3 дні', () => {
  const days = buildDailyForecast(forecast, NOW);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-03', '2026-11-04', '2026-11-05']);
});

test('buildDailyForecast: рахує min/max та бере денну іконку найближчу до полудня', () => {
  const [first] = buildDailyForecast(forecast, NOW);
  assert.equal(first.min, 2);
  assert.equal(first.max, 8);
  assert.equal(first.icon, '01d');
});

test('buildDailyForecast: враховує часовий пояс міста', () => {
  // 22:00 UTC = 00:00 наступного дня в UTC+2 → це вже «завтра» для міста
  const tzForecast = { city: { timezone: 7200 }, list: [item('2026-11-02T22:30:00Z', 4)] };
  const [day] = buildDailyForecast(tzForecast, NOW);
  assert.equal(day.date, '2026-11-03');
});

test('getWeather: мапить відповідь у наш DTO', async () => {
  const client = {
    getCurrent: async () => ({
      name: 'Kyiv', sys: { country: 'UA' }, coord: { lat: 50.45, lon: 30.52 },
      weather: [{ description: 'ясно', icon: '01d' }],
      main: { temp: 10.4, feels_like: 9, humidity: 60, pressure: 1012 },
      wind: { speed: 3 },
    }),
    getForecast: async () => forecast,
  };
  const service = createWeatherService({ client, now: () => NOW });
  const w = await service.getWeather('  Kyiv ');
  assert.equal(w.city, 'Kyiv');
  assert.equal(w.humidity, 60);
  assert.equal(w.forecast.length, 3);
  assert.deepEqual(w.coord, { lat: 50.45, lon: 30.52 });
});

test('getWeather: країна передається клієнту (нормалізована), невідома → 400', async () => {
  const calls = [];
  const current = {
    name: 'Lviv', sys: { country: 'UA' }, coord: { lat: 49.84, lon: 24.03 },
    weather: [{ description: 'ясно', icon: '01d' }],
    main: { temp: 5, feels_like: 3, humidity: 70, pressure: 1010 }, wind: { speed: 2 },
  };
  const client = {
    getCurrent: async (...a) => (calls.push(a), current),
    getForecast: async () => forecast,
  };
  const service = createWeatherService({ client, now: () => NOW });
  await service.getWeather('Lviv', ' ua ');
  assert.deepEqual(calls[0], ['Lviv', 'UA']);

  await assert.rejects(() => service.getWeather('Lviv', 'US'), (e) => e instanceof AppError && e.status === 400);
  await assert.rejects(() => service.getWeather('Lviv', 'UA,PL'), (e) => e instanceof AppError && e.status === 400);
});

test('getCountries: список Європи містить Україну та без дублів', () => {
  const list = createWeatherService({ client: {} }).getCountries();
  assert.ok(list.length >= 45);
  assert.ok(list.some((c) => c.code === 'UA' && c.name === 'Україна'));
  assert.equal(new Set(list.map((c) => c.code)).size, list.length);
});

test('getMapTile: валідний тайл передається клієнту як числа', async () => {
  let args;
  const client = { getMapTile: async (...a) => ((args = a), Buffer.from('png')) };
  const service = createWeatherService({ client });
  const png = await service.getMapTile({ layer: 'wind_new', z: '3', x: '4', y: '5' });
  assert.deepEqual(args, ['wind_new', 3, 4, 5]);
  assert.equal(png.toString(), 'png');
});

test('parseTile: відхиляє чужий шар та координати поза межами', () => {
  const bad = [
    { layer: 'evil/../x', z: 1, x: 0, y: 0 }, // не з білого списку
    { layer: 'wind_new', z: 11, x: 0, y: 0 }, // zoom більший за максимум
    { layer: 'wind_new', z: 2, x: 4, y: 0 }, // на zoom 2 лише x = 0..3
    { layer: 'wind_new', z: 2, x: 0, y: -1 },
  ];
  for (const t of bad) {
    assert.throws(() => parseTile(t), (e) => e instanceof AppError && e.status === 400);
  }
});

test('getWeather: порожнє місто → AppError 400, клієнт не викликається', async () => {
  const client = { getCurrent: () => assert.fail(), getForecast: () => assert.fail() };
  const service = createWeatherService({ client });
  await assert.rejects(() => service.getWeather('   '), (e) => e instanceof AppError && e.status === 400);
});
