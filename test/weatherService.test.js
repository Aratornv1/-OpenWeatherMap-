// Запуск: npm test  (вбудований node:test, без залежностей)
// Бачиш перевагу шарів: сервіс тестуємо БЕЗ мережі, підставивши фейковий client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService, buildDailyForecast } from '../src/services/weatherService.js';
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
      name: 'Kyiv', sys: { country: 'UA' },
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
});

test('getWeather: порожнє місто → AppError 400, клієнт не викликається', async () => {
  const client = { getCurrent: () => assert.fail(), getForecast: () => assert.fail() };
  const service = createWeatherService({ client });
  await assert.rejects(() => service.getWeather('   '), (e) => e instanceof AppError && e.status === 400);
});
