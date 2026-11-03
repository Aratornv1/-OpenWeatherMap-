// ШАР 3 — Client для Open-Meteo (безкоштовний, без ключа, лише некомерційне використання).
// Ліміти безкоштовного API: 600 викликів/хв, 10 000/добу; кожна точка в запиті рахується як виклик —
// тому сервіс над нами кешує сітку та ділить її на порції.
import { AppError } from '../errors.js';

const URL_FORECAST = 'https://api.open-meteo.com/v1/forecast';

export function createOpenMeteoClient({ fetchFn = fetch } = {}) {
  return {
    // points: [{ lat, lon }, …]. Повертає масив (по одному елементу на точку, в тому ж порядку):
    //   { hourly: { time: [unix-секунди], wind_speed_10m: [м/с], wind_direction_10m: [° звідки дме] } }
    async getWind(points, hours) {
      const url = new URL(URL_FORECAST);
      url.search = new URLSearchParams({
        latitude: points.map((p) => p.lat).join(','),
        longitude: points.map((p) => p.lon).join(','),
        hourly: 'wind_speed_10m,wind_direction_10m',
        wind_speed_unit: 'ms',
        forecast_hours: String(hours),
        timeformat: 'unixtime',
        cell_selection: 'nearest', // без «підлаштування під сушу» — над морем лишаємось над морем
      });

      let res;
      try {
        res = await fetchFn(url);
      } catch {
        throw new AppError(502, 'Не вдалося звʼязатися з Open-Meteo.');
      }
      if (res.status === 429) throw new AppError(429, 'Open-Meteo: перевищено ліміт запитів, спробуй пізніше.');
      if (!res.ok) throw new AppError(502, 'Помилка сервісу вітру (Open-Meteo).');

      const body = await res.json();
      return Array.isArray(body) ? body : [body]; // для однієї точки API повертає обʼєкт, а не масив
    },
  };
}
