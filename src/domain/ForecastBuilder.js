import { DailyForecast } from './DailyForecast.js';

// Збирає прогноз по днях зі сирої відповіді /forecast (40 записів по 3 години).
// Групує записи по днях міста й бере N днів після сьогоднішнього. Без побічних ефектів: легко тестувати.
export class ForecastBuilder {
  static DEFAULT_DAYS = 3;

  #days;

  constructor({ days = ForecastBuilder.DEFAULT_DAYS } = {}) {
    this.#days = days;
  }

  // dt — UNIX-секунди (UTC), tz — зсув міста від UTC у секундах → "YYYY-MM-DD" за місцевим часом
  static #localDate(dt, tz) {
    return new Date((dt + tz) * 1000).toISOString().slice(0, 10);
  }

  static #localHour(dt, tz) {
    return new Date((dt + tz) * 1000).getUTCHours();
  }

  build(forecast, nowMs) {
    const tz = forecast.city.timezone;
    const today = ForecastBuilder.#localDate(Math.floor(nowMs / 1000), tz);

    const byDay = new Map();
    for (const item of forecast.list) {
      const day = ForecastBuilder.#localDate(item.dt, tz);
      if (day === today) continue; // сьогодні показує блок «зараз»
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(item);
    }

    return [...byDay.entries()].slice(0, this.#days).map(([date, items]) => this.#summarize(date, items, tz));
  }

  #summarize(date, items, tz) {
    const temps = items.map((i) => i.main.temp);
    const humidity = items.reduce((sum, i) => sum + i.main.humidity, 0) / items.length;
    // Іконка й опис — із запису, найближчого до полудня
    const noon = items.reduce((best, i) =>
      Math.abs(ForecastBuilder.#localHour(i.dt, tz) - 12) < Math.abs(ForecastBuilder.#localHour(best.dt, tz) - 12) ? i : best,
    );
    return new DailyForecast({
      date,
      min: Math.min(...temps),
      max: Math.max(...temps),
      humidity: Math.round(humidity),
      icon: noon.weather[0].icon.replace('n', 'd'), // нічна іконка на картці дня виглядає дивно
      description: noon.weather[0].description,
    });
  }
}
