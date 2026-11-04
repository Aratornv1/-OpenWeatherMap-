// ШАР 2 — Service для карт по сітці: анімований вітер і опади.
// Бере прогноз по сітці над Європою ОДНИМ набором запитів до Open-Meteo, кешує його
// (щоб не вичерпати ліміти) і віддає по одній годині у вигляді кадрів:
//   • вітер  → WindFrame ([U, V] для leaflet-velocity);
//   • опади  → PrecipitationFrame (плоский масив мм/год для власного canvas-шару);
//   • температура → TemperatureFrame (плоский масив °C для того ж canvas-шару).
import { ForecastHour } from '../domain/ForecastHour.js';
import { Grid } from '../domain/Grid.js';
import { GridSnapshot } from '../domain/GridSnapshot.js';
import { PrecipitationFrame, TemperatureFrame, WindFrame } from '../domain/Frame.js';
import { WindVector } from '../domain/WindVector.js';
import { UpstreamError } from '../errors.js';

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

export class GridService {
  static FORECAST_HOURS = 72;
  static CHUNK_SIZE = 100; // точок в одному запиті до Open-Meteo
  static TTL_MS = 3 * 60 * 60 * 1000; // модель оновлюється раз на кілька годин — частіше питати марно
  static RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;

  #client;
  #grid;
  #now;
  #sleep;
  #pauseMs;
  #snapshot = null; // GridSnapshot у памʼяті
  #inflight = null; // Promise оновлення, що вже виконується
  #store;
  #restored = false; // чи вже пробували підняти знімок із диска

  // store — необовʼязковий дисковий кеш (load/save); без нього знімок живе лише в памʼяті
  constructor({ client, grid = Grid.EUROPE, now = Date.now, sleep = sleepMs, pauseMs = 1000, store = null }) {
    this.#client = client;
    this.#store = store;
    this.#grid = grid;
    this.#now = now;
    this.#sleep = sleep; // у тесті «сон» миттєвий
    this.#pauseMs = pauseMs;
  }

  // hour = 0 — поточна година, 1 — наступна і т.д.
  async getWindFrame(rawHour) {
    const { snapshot, idx, meta } = await this.#locate(rawHour);
    const u = [];
    const v = [];
    for (let p = 0; p < snapshot.speed.length; p++) {
      const wind = WindVector.fromMeteo(snapshot.speed[p][idx] ?? 0, snapshot.dir[p][idx] ?? 0);
      u.push(round2(wind.u));
      v.push(round2(wind.v));
    }
    return WindFrame.of(meta, this.#grid, u, v);
  }

  // Опади за годину, мм (Open-Meteo: сума за попередню годину). Немає даних → 0.
  async getPrecipitationFrame(rawHour) {
    const { snapshot, idx, meta } = await this.#locate(rawHour);
    const values = snapshot.precip.map((series) => round2(series[idx] ?? 0));
    return new PrecipitationFrame(meta, this.#grid.describe(), values);
  }

  // Температура на 2 м, °C. Немає даних → null (0 °C — теж температура, її підставляти не можна).
  async getTemperatureFrame(rawHour) {
    const { snapshot, idx, meta } = await this.#locate(rawHour);
    const values = snapshot.temp.map((series) => (Number.isFinite(series[idx]) ? round1(series[idx]) : null));
    return new TemperatureFrame(meta, this.#grid.describe(), values);
  }

  // Спільна частина для всіх кадрів: перевірка години, свіжий знімок, зсув до поточної години
  async #locate(rawHour) {
    const hour = ForecastHour.parse(rawHour).value;
    const snapshot = await this.#freshSnapshot();
    const { idx, available, time } = snapshot.locate(this.#now(), hour);
    return { snapshot, idx, meta: { hour, hours: available, time } };
  }

  // Свіжий знімок → віддаємо. Інакше оновлюємо; кілька одночасних запитів ділять один запит назовні.
  async #freshSnapshot() {
    await this.#restore();
    if (this.#snapshot?.isFresh(this.#now(), GridService.TTL_MS)) return this.#snapshot;
    this.#inflight ??= this.#download()
      .then(async (fresh) => {
        this.#snapshot = fresh;
        await this.#store?.save(fresh);
        return fresh;
      })
      .catch((err) => {
        if (!this.#snapshot) throw err;
        // Є старий знімок: лишаємо його й пробуємо знову за 10 хвилин, а не на кожен запит
        this.#snapshot = this.#snapshot.postponeRefresh(this.#now(), GridService.TTL_MS, GridService.RETRY_AFTER_FAIL_MS);
        return this.#snapshot;
      })
      .finally(() => { this.#inflight = null; });
    return this.#inflight;
  }

  // Одноразово, перед першим запитом: беремо знімок із диска, якщо він ще свіжий і підходить до нашої сітки
  async #restore() {
    if (this.#restored || !this.#store) return;
    this.#restored = true;
    const saved = await this.#store.load();
    const fits = saved && saved.speed.length === this.#grid.pointCount;
    if (fits && saved.isFresh(this.#now(), GridService.TTL_MS)) this.#snapshot = saved;
  }

  async #download() {
    const points = this.#grid.points();
    const speed = [];
    const dir = [];
    const precip = [];
    const temp = [];
    let times = null;

    for (let i = 0; i < points.length; i += GridService.CHUNK_SIZE) {
      if (i > 0) await this.#sleep(this.#pauseMs); // не частимо: ліміт 600 викликів на хвилину
      const chunk = points.slice(i, i + GridService.CHUNK_SIZE);
      const results = await this.#client.getGrid(chunk, GridService.FORECAST_HOURS);
      if (results.length !== chunk.length) throw new UpstreamError('Open-Meteo повернув неповні дані.');

      for (const r of results) {
        times ??= r.hourly.time;
        speed.push(r.hourly.wind_speed_10m);
        dir.push(r.hourly.wind_direction_10m);
        precip.push(r.hourly.precipitation);
        temp.push(r.hourly.temperature_2m);
      }
    }
    return new GridSnapshot({ fetchedAt: this.#now(), startSec: times[0], hours: times.length, speed, dir, precip, temp });
  }
}
