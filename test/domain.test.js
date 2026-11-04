// Доменні класи: перевірка вводу, незмінність, форма JSON. Мережа не потрібна.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CountryRegistry } from '../src/domain/CountryRegistry.js';
import { CityQuery } from '../src/domain/CityQuery.js';
import { TileRequest } from '../src/domain/TileRequest.js';
import { ForecastHour } from '../src/domain/ForecastHour.js';
import { Coordinate } from '../src/domain/Coordinate.js';
import { WindVector } from '../src/domain/WindVector.js';
import { Grid } from '../src/domain/Grid.js';
import { GridSnapshot } from '../src/domain/GridSnapshot.js';
import { DailyForecast } from '../src/domain/DailyForecast.js';
import { Weather } from '../src/domain/Weather.js';
import { ForecastBuilder } from '../src/domain/ForecastBuilder.js';
import { Frame, ScalarFrame, WindFrame, PrecipitationFrame, TemperatureFrame } from '../src/domain/Frame.js';
import { ValidationError } from '../src/errors.js';

const isValidation = (e) => e instanceof ValidationError && e.status === 400;

// ── CountryRegistry ──
test('CountryRegistry.europe: ≥45 країн, є Україна, без дублів, відсортовано за назвою', () => {
  const list = CountryRegistry.europe().list();
  assert.ok(list.length >= 45);
  assert.ok(list.some((c) => c.code === 'UA' && c.name === 'Україна'));
  assert.equal(new Set(list.map((c) => c.code)).size, list.length);
  const names = list.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'uk')));
});

test('CountryRegistry: has() і normalize()', () => {
  const reg = new CountryRegistry({ UA: 'Україна', PL: 'Польща' });
  assert.equal(reg.has('UA'), true);
  assert.equal(reg.has('US'), false);
  assert.equal(reg.has('toString'), false); // не береться з прототипу
  assert.equal(reg.normalize(' ua '), 'UA');
  assert.equal(reg.normalize(''), '');
  assert.equal(reg.normalize(null), '');
  assert.equal(reg.normalize(undefined), '');
  assert.throws(() => reg.normalize('US'), isValidation);
  assert.throws(() => reg.normalize('UA,PL'), isValidation);
});

test('CountryRegistry: список заморожено, а зміна вхідного обʼєкта його не чіпає', () => {
  const src = { UA: 'Україна' };
  const reg = new CountryRegistry(src);
  src.XX = 'Хтось';
  assert.equal(reg.has('XX'), false);
  assert.ok(Object.isFrozen(reg.list()));
  assert.ok(Object.isFrozen(reg.list()[0]));
});

// ── CityQuery ──
test('CityQuery.parse: обрізає пробіли, нормалізує країну, обʼєкт заморожено', () => {
  const q = CityQuery.parse('  Kyiv ', ' ua ', CountryRegistry.europe());
  assert.equal(q.name, 'Kyiv');
  assert.equal(q.country, 'UA');
  assert.ok(Object.isFrozen(q));
});

test('CityQuery.parse: порожнє, лише пробіли, null і задовге місто → 400', () => {
  const reg = CountryRegistry.europe();
  for (const bad of ['', '   ', null, undefined, 'x'.repeat(101)]) {
    assert.throws(() => CityQuery.parse(bad, '', reg), isValidation);
  }
  assert.doesNotThrow(() => CityQuery.parse('x'.repeat(100), '', reg));
});

test('CityQuery.parse: без країни — country порожній рядок; невідома країна → 400', () => {
  const reg = CountryRegistry.europe();
  assert.equal(CityQuery.parse('Lviv', null, reg).country, '');
  assert.throws(() => CityQuery.parse('Lviv', 'US', reg), isValidation);
});

// ── TileRequest ──
test('TileRequest.parse: числа з рядків, обʼєкт заморожено', () => {
  const t = TileRequest.parse({ layer: 'wind_new', z: '3', x: '4', y: '5' });
  assert.deepEqual({ ...t }, { layer: 'wind_new', z: 3, x: 4, y: 5 });
  assert.ok(Object.isFrozen(t));
});

test('TileRequest.parse: чужий шар, zoom > 10, координати поза межами, не числа → 400', () => {
  const bad = [
    { layer: 'evil/../x', z: 1, x: 0, y: 0 },
    { layer: 'wind_new', z: 11, x: 0, y: 0 },
    { layer: 'wind_new', z: 2, x: 4, y: 0 }, // на zoom 2 лише 0..3
    { layer: 'wind_new', z: 2, x: 0, y: -1 },
    { layer: 'wind_new', z: 'a', x: 0, y: 0 },
    { layer: 'wind_new', z: 1.5, x: 0, y: 0 },
  ];
  for (const t of bad) assert.throws(() => TileRequest.parse(t), isValidation);
});

test('TileRequest.parse: межа — на zoom 10 дозволено x = 1023', () => {
  assert.doesNotThrow(() => TileRequest.parse({ layer: 'clouds_new', z: 10, x: 1023, y: 1023 }));
  assert.throws(() => TileRequest.parse({ layer: 'clouds_new', z: 10, x: 1024, y: 0 }), isValidation);
});

// ── ForecastHour ──
test('ForecastHour.parse: 0 за замовчуванням, рядки приймає, сміття відхиляє', () => {
  assert.equal(ForecastHour.parse(null).value, 0);
  assert.equal(ForecastHour.parse(undefined).value, 0);
  assert.equal(ForecastHour.parse('5').value, 5);
  assert.equal(ForecastHour.parse(0).value, 0);
  for (const bad of [-1, 1.5, 'abc', NaN]) assert.throws(() => ForecastHour.parse(bad), isValidation);
});

// ── Coordinate, WindVector ──
test('Coordinate: заморожена, toJSON дає { lat, lon }', () => {
  const c = new Coordinate(50.45, 30.52);
  assert.ok(Object.isFrozen(c));
  assert.equal(JSON.stringify(c), '{"lat":50.45,"lon":30.52}');
});

test('WindVector.fromMeteo: західний вітер дме на схід (u>0), північний — на південь (v<0)', () => {
  const west = WindVector.fromMeteo(5, 270);
  assert.ok(Math.abs(west.u - 5) < 1e-9 && Math.abs(west.v) < 1e-9);
  const north = WindVector.fromMeteo(5, 0);
  assert.ok(Math.abs(north.u) < 1e-9 && Math.abs(north.v + 5) < 1e-9);
  assert.ok(Object.isFrozen(north));
});

// ── Grid ──
test('Grid.EUROPE: 29 × 17 = 493 точки, опис для клієнта', () => {
  const g = Grid.EUROPE;
  assert.equal(g.nx, 29);
  assert.equal(g.ny, 17);
  assert.equal(g.pointCount, 493);
  assert.deepEqual(g.describe(), { la1: 72.5, la2: 32.5, lo1: -25, lo2: 45, dx: 2.5, dy: 2.5, nx: 29, ny: 17 });
});

test('Grid.points: з північного заходу, рядками; кількість = nx × ny', () => {
  const g = Grid.EUROPE;
  const pts = g.points();
  assert.equal(pts.length, g.pointCount);
  assert.deepEqual({ ...pts[0] }, { lat: 72.5, lon: -25 });
  assert.deepEqual({ ...pts[1] }, { lat: 72.5, lon: -22.5 }); // далі на схід
  assert.deepEqual({ ...pts[g.nx] }, { lat: 70, lon: -25 }); // наступний рядок — південніше
  assert.deepEqual({ ...pts.at(-1) }, { lat: 32.5, lon: 45 });
  assert.ok(pts[0] instanceof Coordinate);
});

test('Grid: маленька власна сітка і заморожений обʼєкт', () => {
  const g = new Grid({ la1: 10, la2: 0, lo1: 0, lo2: 20, step: 10 });
  assert.equal(g.ny, 2);
  assert.equal(g.nx, 3);
  assert.equal(g.points().length, 6);
  assert.ok(Object.isFrozen(g));
});

// ── GridSnapshot ──
const START = 1_700_000_000 - (1_700_000_000 % 3600);
const snap = (extra = {}) =>
  new GridSnapshot({ fetchedAt: START * 1000, startSec: START, hours: 72, speed: [], dir: [], precip: [], ...extra });

test('GridSnapshot.isFresh: свіжий до закінчення TTL', () => {
  const s = snap();
  assert.equal(s.isFresh(START * 1000 + 1000, 5000), true);
  assert.equal(s.isFresh(START * 1000 + 5000, 5000), false);
});

test('GridSnapshot.postponeRefresh: нова копія, свіжа ще retryMs; оригінал не змінюється', () => {
  const s = snap();
  const now = START * 1000 + 100_000;
  const p = s.postponeRefresh(now, 10_000, 3000);
  assert.notEqual(p, s);
  assert.equal(s.fetchedAt, START * 1000);
  assert.equal(p.isFresh(now + 2999, 10_000), true);
  assert.equal(p.isFresh(now + 3000, 10_000), false);
  assert.equal(p.hours, s.hours);
});

test('GridSnapshot.locate: година 0 = «зараз», а не початок кешу', () => {
  const s = snap();
  const r0 = s.locate(START * 1000, 0);
  assert.deepEqual(r0, { idx: 0, available: 72, time: new Date(START * 1000).toISOString() });
  const r4 = s.locate((START + 4 * 3600) * 1000, 2); // кеш на 4 години старший
  assert.equal(r4.idx, 6);
  assert.equal(r4.available, 68);
});

test('GridSnapshot.locate: до початку кешу base не мінусовий; за межами → 400', () => {
  const s = snap();
  assert.equal(s.locate((START - 7200) * 1000, 0).idx, 0);
  assert.throws(() => s.locate(START * 1000, 72), isValidation);
  assert.doesNotThrow(() => s.locate(START * 1000, 71));
  assert.throws(() => s.locate((START + 4 * 3600) * 1000, 68), isValidation);
});

// ── DailyForecast, Weather ──
test('DailyForecast.toJSON: порядок полів зафіксовано', () => {
  const d = new DailyForecast({ description: 'дощ', icon: '10d', humidity: 80, max: 8, min: 2, date: '2026-11-03' });
  assert.deepEqual(Object.keys(d.toJSON()), ['date', 'min', 'max', 'humidity', 'icon', 'description']);
});

const CURRENT = {
  name: 'Kyiv', sys: { country: 'UA' }, coord: { lat: 50.45, lon: 30.52 },
  weather: [{ description: 'ясно', icon: '01d' }],
  main: { temp: 10.4, feels_like: 9, humidity: 60, pressure: 1012 },
  wind: { speed: 3 },
};

test('Weather.fromApi: перекладає формат OpenWeatherMap у наш; порядок полів JSON зафіксовано', () => {
  const day = new DailyForecast({ date: '2026-11-03', min: 2, max: 8, humidity: 80, icon: '01d', description: 'ясно' });
  const w = Weather.fromApi(CURRENT, [day]);
  assert.equal(w.city, 'Kyiv');
  assert.equal(w.feelsLike, 9);
  assert.ok(w.coord instanceof Coordinate);
  const parsed = JSON.parse(JSON.stringify(w));
  assert.deepEqual(Object.keys(parsed), [
    'city', 'country', 'description', 'icon', 'temp', 'feelsLike', 'humidity', 'pressure', 'windSpeed', 'coord', 'forecast',
  ]);
  assert.deepEqual(parsed.coord, { lat: 50.45, lon: 30.52 });
  assert.deepEqual(Object.keys(parsed.forecast[0]), ['date', 'min', 'max', 'humidity', 'icon', 'description']);
});

// ── ForecastBuilder ──
const NOW = Date.parse('2026-11-02T10:00:00Z');
const item = (iso, temp, icon = '10n', humidity = 80) => ({
  dt: Date.parse(iso) / 1000,
  main: { temp, humidity },
  weather: [{ icon, description: 'дощ' }],
});
const forecast = {
  city: { timezone: 0 },
  list: [
    item('2026-11-02T15:00:00Z', 9), // сьогодні — відкинуто
    item('2026-11-03T03:00:00Z', 2),
    item('2026-11-03T12:00:00Z', 8, '01d'),
    item('2026-11-04T12:00:00Z', 5),
    item('2026-11-05T12:00:00Z', 6),
    item('2026-11-06T12:00:00Z', 7), // 4-й день — відкинуто
  ],
};

test('ForecastBuilder: пропускає сьогодні й повертає рівно 3 дні (DailyForecast)', () => {
  const days = new ForecastBuilder().build(forecast, NOW);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-03', '2026-11-04', '2026-11-05']);
  assert.ok(days.every((d) => d instanceof DailyForecast));
});

test('ForecastBuilder: min/max, денна іконка найближча до полудня, нічна → денна', () => {
  const [first, second] = new ForecastBuilder().build(forecast, NOW);
  assert.equal(first.min, 2);
  assert.equal(first.max, 8);
  assert.equal(first.icon, '01d');
  assert.equal(second.icon, '10d'); // '10n' → '10d'
});

test('ForecastBuilder: вологість — округлене середнє', () => {
  const f = { city: { timezone: 0 }, list: [item('2026-11-03T06:00:00Z', 1, '01d', 50), item('2026-11-03T12:00:00Z', 2, '01d', 61)] };
  assert.equal(new ForecastBuilder().build(f, NOW)[0].humidity, 56); // 55.5 → 56
});

test('ForecastBuilder: враховує часовий пояс міста', () => {
  // 22:30 UTC = 00:30 наступного дня в UTC+2 → це вже «завтра» для міста
  const tz = { city: { timezone: 7200 }, list: [item('2026-11-02T22:30:00Z', 4)] };
  assert.equal(new ForecastBuilder().build(tz, NOW)[0].date, '2026-11-03');
});

test('ForecastBuilder: кількість днів налаштовується; DEFAULT_DAYS = 3', () => {
  assert.equal(ForecastBuilder.DEFAULT_DAYS, 3);
  assert.equal(new ForecastBuilder({ days: 1 }).build(forecast, NOW).length, 1);
  assert.equal(new ForecastBuilder({ days: 10 }).build(forecast, NOW).length, 4);
});

// ── Frame ──
test('Frame — абстрактний: напряму створити не можна', () => {
  assert.throws(() => new Frame({ hour: 0, hours: 1, time: 't' }), TypeError);
});

test('WindFrame.of: два обʼєкти U/V з заголовком для leaflet-velocity; toJSON з полями бази', () => {
  const meta = { hour: 1, hours: 71, time: '2026-01-01T01:00:00.000Z' };
  const frame = WindFrame.of(meta, Grid.EUROPE, [1], [2]);
  assert.ok(frame instanceof Frame);
  const [u, v] = frame.data;
  assert.equal(u.header.parameterNumber, 2);
  assert.equal(v.header.parameterNumber, 3);
  assert.equal(u.header.nx, 29);
  assert.equal(u.header.la1, 72.5);
  assert.equal(u.header.refTime, meta.time);
  assert.deepEqual(Object.keys(frame.toJSON()), ['hour', 'hours', 'time', 'data']);
  assert.deepEqual(JSON.parse(JSON.stringify(frame)).data[1].data, [2]);
});

test('PrecipitationFrame.toJSON: hour, hours, time, grid, values', () => {
  const meta = { hour: 0, hours: 72, time: 't' };
  const frame = new PrecipitationFrame(meta, Grid.EUROPE.describe(), [0, 0.5]);
  assert.ok(frame instanceof Frame);
  assert.deepEqual(Object.keys(frame.toJSON()), ['hour', 'hours', 'time', 'grid', 'values']);
  assert.deepEqual(JSON.parse(JSON.stringify(frame)).values, [0, 0.5]);
});

test('поліморфізм: JSON.stringify поводиться по-різному для різних кадрів через toJSON', () => {
  const meta = { hour: 0, hours: 1, time: 't' };
  const wind = JSON.parse(JSON.stringify(WindFrame.of(meta, Grid.EUROPE, [], [])));
  const rain = JSON.parse(JSON.stringify(new PrecipitationFrame(meta, {}, [])));
  assert.ok('data' in wind && !('values' in wind));
  assert.ok('values' in rain && !('data' in rain));
});

test('ScalarFrame — абстрактний; PrecipitationFrame і TemperatureFrame — його нащадки з однаковою формою JSON', () => {
  const meta = { hour: 1, hours: 70, time: '2026-11-03T10:00:00.000Z' };
  assert.throws(() => new ScalarFrame(meta, {}, []), TypeError);
  const t = new TemperatureFrame(meta, Grid.EUROPE.describe(), [-3.5, null, 12]);
  assert.ok(t instanceof ScalarFrame && t instanceof Frame);
  assert.deepEqual(JSON.parse(JSON.stringify(t)).values, [-3.5, null, 12]);
  assert.deepEqual(Object.keys(t.toJSON()), Object.keys(new PrecipitationFrame(meta, {}, []).toJSON()));
});

// ── GridSnapshot.fromJSON ──
test('GridSnapshot.fromJSON: коректний JSON відновлюється, зіпсований чи старого формату → null', () => {
  const ok = { fetchedAt: 1, startSec: 2, hours: 2, speed: [[1, 2]], dir: [[1, 2]], precip: [[0, 0]], temp: [[5, 6]] };
  const restored = GridSnapshot.fromJSON(JSON.parse(JSON.stringify(ok)));
  assert.ok(restored instanceof GridSnapshot);
  assert.deepEqual(restored.temp, [[5, 6]]);
  assert.equal(GridSnapshot.fromJSON(null), null);
  assert.equal(GridSnapshot.fromJSON({ ...ok, temp: undefined }), null); // знімок без температури (старий формат)
  assert.equal(GridSnapshot.fromJSON({ ...ok, temp: [] }), null);
  assert.equal(GridSnapshot.fromJSON({ ...ok, dir: [[1], [2]] }), null); // різна кількість точок
  assert.equal(GridSnapshot.fromJSON({ ...ok, fetchedAt: 'вчора' }), null);
});
