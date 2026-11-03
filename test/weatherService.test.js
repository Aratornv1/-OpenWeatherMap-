// Запуск: npm test  (вбудований node:test, без залежностей)
// Бачиш перевагу шарів: сервіс тестуємо БЕЗ мережі, підставивши фейковий client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WeatherService } from '../src/services/WeatherService.js';
import { CountryRegistry } from '../src/domain/CountryRegistry.js';
import { CityQuery } from '../src/domain/CityQuery.js';
import { TileRequest } from '../src/domain/TileRequest.js';
import { Weather } from '../src/domain/Weather.js';
import { ForecastBuilder } from '../src/domain/ForecastBuilder.js';
import { NotFoundError, ValidationError } from '../src/errors.js';

const NOW = Date.parse('2026-11-02T10:00:00Z');

const item = (iso, temp, icon = '10n') => ({
  dt: Date.parse(iso) / 1000,
  main: { temp, humidity: 80 },
  weather: [{ icon, description: 'дощ' }],
});

const forecast = {
  city: { timezone: 0 },
  list: [
    item('2026-11-02T15:00:00Z', 9),
    item('2026-11-03T03:00:00Z', 2),
    item('2026-11-03T12:00:00Z', 8, '01d'),
    item('2026-11-04T12:00:00Z', 5),
    item('2026-11-05T12:00:00Z', 6),
    item('2026-11-06T12:00:00Z', 7),
  ],
};

const current = {
  name: 'Kyiv', sys: { country: 'UA' }, coord: { lat: 50.45, lon: 30.52 },
  weather: [{ description: 'ясно', icon: '01d' }],
  main: { temp: 10.4, feels_like: 9, humidity: 60, pressure: 1012 },
  wind: { speed: 3 },
};

const isValidation = (e) => e instanceof ValidationError && e.status === 400;

test('getWeather: мапить відповідь у наш DTO (Weather)', async () => {
  const client = { getCurrent: async () => current, getForecast: async () => forecast };
  const service = new WeatherService({ client, now: () => NOW });
  const w = await service.getWeather('  Kyiv ');
  assert.ok(w instanceof Weather);
  assert.equal(w.city, 'Kyiv');
  assert.equal(w.humidity, 60);
  assert.equal(w.forecast.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(w)).coord, { lat: 50.45, lon: 30.52 });
});

test('getWeather: клієнту передається CityQuery (нормалізована країна), невідома → 400', async () => {
  const calls = [];
  const client = {
    getCurrent: async (q) => (calls.push(q), current),
    getForecast: async () => forecast,
  };
  const service = new WeatherService({ client, now: () => NOW });
  await service.getWeather('Lviv', ' ua ');
  assert.ok(calls[0] instanceof CityQuery);
  assert.deepEqual({ ...calls[0] }, { name: 'Lviv', country: 'UA' });

  await assert.rejects(() => service.getWeather('Lviv', 'US'), isValidation);
  await assert.rejects(() => service.getWeather('Lviv', 'UA,PL'), isValidation);
});

test('getWeather: поточна погода й прогноз просяться паралельно (обидва виклики стартують до відповіді)', async () => {
  const started = [];
  const client = {
    getCurrent: async () => { started.push('current'); await Promise.resolve(); return current; },
    getForecast: async () => { started.push('forecast'); await Promise.resolve(); return forecast; },
  };
  const service = new WeatherService({ client, now: () => NOW });
  const promise = service.getWeather('Kyiv');
  assert.deepEqual(started, ['current', 'forecast']); // обидва вже стартували синхронно
  await promise;
});

test('getWeather: порожнє місто → 400, клієнт не викликається', async () => {
  const client = { getCurrent: () => assert.fail(), getForecast: () => assert.fail() };
  const service = new WeatherService({ client });
  await assert.rejects(() => service.getWeather('   '), isValidation);
});

test('getWeather: помилка клієнта проходить без змін (контролер сам перетворить на HTTP)', async () => {
  const client = {
    getCurrent: async () => { throw new NotFoundError('Місто не знайдено'); },
    getForecast: async () => forecast,
  };
  const service = new WeatherService({ client, now: () => NOW });
  await assert.rejects(() => service.getWeather('Nowhere'), (e) => e instanceof NotFoundError && e.status === 404);
});

test('ін’єкція залежностей: власні CountryRegistry і ForecastBuilder підміняють стандартні', async () => {
  const client = { getCurrent: async () => current, getForecast: async () => forecast };
  const service = new WeatherService({
    client,
    now: () => NOW,
    countries: new CountryRegistry({ UA: 'Україна' }),
    forecastBuilder: new ForecastBuilder({ days: 1 }),
  });
  assert.equal((await service.getWeather('Kyiv', 'UA')).forecast.length, 1);
  await assert.rejects(() => service.getWeather('Kyiv', 'PL'), isValidation);
  assert.deepEqual(service.getCountries().map((c) => c.code), ['UA']);
});

test('getCountries: список Європи містить Україну та без дублів', () => {
  const list = new WeatherService({ client: {} }).getCountries();
  assert.ok(list.length >= 45);
  assert.ok(list.some((c) => c.code === 'UA' && c.name === 'Україна'));
  assert.equal(new Set(list.map((c) => c.code)).size, list.length);
});

test('getMapTile: валідний тайл передається клієнту як TileRequest із числами', async () => {
  let arg;
  const client = { getMapTile: async (t) => ((arg = t), Buffer.from('png')) };
  const png = await new WeatherService({ client }).getMapTile({ layer: 'wind_new', z: '3', x: '4', y: '5' });
  assert.ok(arg instanceof TileRequest);
  assert.deepEqual({ ...arg }, { layer: 'wind_new', z: 3, x: 4, y: 5 });
  assert.equal(png.toString(), 'png');
});

test('getMapTile: некоректний тайл → 400 ДО запиту назовні', async () => {
  const client = { getMapTile: () => assert.fail('клієнт не мав викликатись') };
  const service = new WeatherService({ client });
  await assert.rejects(() => service.getMapTile({ layer: 'evil/../x', z: 1, x: 0, y: 0 }), isValidation);
  await assert.rejects(() => service.getMapTile({ layer: 'wind_new', z: 2, x: 4, y: 0 }), isValidation);
});
