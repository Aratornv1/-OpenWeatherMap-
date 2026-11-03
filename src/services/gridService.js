// ШАР 2 — Service для карт по сітці: анімований вітер і опади.
// Бере прогноз по сітці над Європою ОДНИМ набором запитів до Open-Meteo, кешує його
// (щоб не вичерпати ліміти) і віддає по одній годині:
//   • вітер  → [U, V] у форматі leaflet-velocity;
//   • опади  → плоский масив мм/год + опис сітки для власного canvas-шару.
import { AppError } from '../errors.js';

// Сітка: рядки йдуть з ПІВНОЧІ на південь, колонки — із заходу на схід (так вимагає leaflet-velocity).
export const GRID = { la1: 72.5, la2: 32.5, lo1: -25, lo2: 45, step: 2.5 };

const FORECAST_HOURS = 72;
const CHUNK_SIZE = 100; // точок в одному запиті до Open-Meteo
const TTL_MS = 3 * 60 * 60 * 1000; // модель оновлюється раз на кілька годин — частіше питати марно
const RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;

const round2 = (n) => Math.round(n * 100) / 100;

export function gridSize(grid = GRID) {
  return {
    ny: Math.round((grid.la1 - grid.la2) / grid.step) + 1,
    nx: Math.round((grid.lo2 - grid.lo1) / grid.step) + 1,
  };
}

// Опис сітки для клієнта: з нього він знає, де лежить кожне значення масиву.
export function gridInfo(grid = GRID) {
  const { nx, ny } = gridSize(grid);
  return { la1: grid.la1, la2: grid.la2, lo1: grid.lo1, lo2: grid.lo2, dx: grid.step, dy: grid.step, nx, ny };
}

// Усі точки сітки в порядку даних: рядок за рядком, з північного заходу.
export function gridPoints(grid = GRID) {
  const { ny, nx } = gridSize(grid);
  const points = [];
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      points.push({ lat: grid.la1 - r * grid.step, lon: grid.lo1 + c * grid.step });
    }
  }
  return points;
}

// Метеорологічний напрямок — ЗВІДКИ дме вітер (0° = північний, дме на південь).
// U — на схід, V — на північ.
export function toUV(speed, directionDeg) {
  const rad = (directionDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
}

// Збирає два «GRIB-подібні» обʼєкти (U і V) для leaflet-velocity з масивів значень сітки.
export function buildVelocityData(uValues, vValues, refTimeIso, grid = GRID) {
  const { lo1, lo2, la1, la2, dx, dy, nx, ny } = gridInfo(grid);
  const header = (parameterNumber, parameterNumberName) => ({
    parameterCategory: 2, parameterNumber, parameterNumberName, parameterUnit: 'm.s-1',
    lo1, lo2, la1, la2, dx, dy, nx, ny, refTime: refTimeIso,
  });
  return [
    { header: header(2, 'U-component_of_wind'), data: uValues },
    { header: header(3, 'V-component_of_wind'), data: vValues },
  ];
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGridService({ client, now = Date.now, sleep = sleepMs, pauseMs = 1000 }) {
  let cache = null; // { fetchedAt, startSec, hours, speed, dir, precip } — масиви по точках
  let inflight = null;

  async function fetchGrid() {
    const points = gridPoints();
    const speed = [];
    const dir = [];
    const precip = [];
    let times = null;

    for (let i = 0; i < points.length; i += CHUNK_SIZE) {
      if (i > 0) await sleep(pauseMs); // не частимо: ліміт 600 викликів на хвилину
      const chunk = points.slice(i, i + CHUNK_SIZE);
      const results = await client.getGrid(chunk, FORECAST_HOURS);
      if (results.length !== chunk.length) throw new AppError(502, 'Open-Meteo повернув неповні дані.');

      for (const r of results) {
        times ??= r.hourly.time;
        speed.push(r.hourly.wind_speed_10m);
        dir.push(r.hourly.wind_direction_10m);
        precip.push(r.hourly.precipitation);
      }
    }
    return { fetchedAt: now(), startSec: times[0], hours: times.length, speed, dir, precip };
  }

  // Свіжий кеш → віддаємо. Інакше оновлюємо; кілька одночасних запитів ділять один запит назовні.
  async function ensureFresh() {
    if (cache && now() - cache.fetchedAt < TTL_MS) return cache;
    inflight ??= fetchGrid()
      .then((fresh) => (cache = fresh))
      .catch((err) => {
        if (!cache) throw err;
        cache = { ...cache, fetchedAt: now() - TTL_MS + RETRY_AFTER_FAIL_MS }; // лишаємо старе, спробуємо пізніше
        return cache;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  // Спільна частина для всіх кадрів: перевірка години, зсув від початку кешу, час кадру.
  async function locate(rawHour) {
    const hour = Number(rawHour ?? 0);
    if (!Number.isInteger(hour) || hour < 0) throw new AppError(400, 'Некоректна година прогнозу.');

    const c = await ensureFresh();
    // Кеш міг зʼявитись кілька годин тому: зсуваємо початок до поточної години
    const base = Math.max(0, Math.floor((now() / 1000 - c.startSec) / 3600));
    const idx = base + hour;
    const available = c.hours - base;
    if (idx >= c.hours) throw new AppError(400, `Прогноз доступний лише на ${available} год.`);

    const time = new Date((c.startSec + idx * 3600) * 1000).toISOString();
    return { c, hour, idx, meta: { hour, hours: available, time } };
  }

  return {
    // hour = 0 — поточна година, 1 — наступна і т.д.
    async getWindFrame(rawHour) {
      const { c, idx, meta } = await locate(rawHour);
      const u = [];
      const v = [];
      for (let p = 0; p < c.speed.length; p++) {
        const wind = toUV(c.speed[p][idx] ?? 0, c.dir[p][idx] ?? 0);
        u.push(round2(wind.u));
        v.push(round2(wind.v));
      }
      return { ...meta, data: buildVelocityData(u, v, meta.time) };
    },

    // Опади за годину, мм (Open-Meteo: сума за попередню годину). Немає даних → 0.
    async getPrecipitationFrame(rawHour) {
      const { c, idx, meta } = await locate(rawHour);
      const values = c.precip.map((series) => round2(series[idx] ?? 0));
      return { ...meta, grid: gridInfo(), values };
    },
  };
}
