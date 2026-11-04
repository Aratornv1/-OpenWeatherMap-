import { ApiClient } from './ApiClient.js';
import { RateLimitError, UpstreamError } from '../errors.js';

// Клієнт Open-Meteo: прогноз по сітці точок (безкоштовний, без ключа, лише некомерційне використання).
// Ліміти безкоштовного API: 600 викликів/хв, 10 000/добу; кожна точка в запиті рахується як виклик —
// тому сервіс над нами кешує сітку та ділить її на порції.
export class OpenMeteoClient extends ApiClient {
  static URL = 'https://api.open-meteo.com/v1/forecast';

  get serviceName() {
    return 'Open-Meteo';
  }

  // Тут лише два випадки: ліміт і «все інше». Тексти відрізняються від OpenWeatherMap.
  errorForStatus(status) {
    if (status === 429) return new RateLimitError('Open-Meteo: перевищено ліміт запитів, спробуй пізніше.');
    return new UpstreamError('Помилка сервісу вітру (Open-Meteo).');
  }

  // points: Coordinate[]. Повертає масив (по одному елементу на точку, в тому ж порядку):
  //   { hourly: { time: [unix-секунди], wind_speed_10m: [м/с], wind_direction_10m: [° звідки дме],
  //               precipitation: [мм за попередню годину], temperature_2m: [°C] } }
  // Кілька змінних в одному запиті не збільшують кількість викликів: рахується кожна точка.
  async getGrid(points, hours) {
    const url = new URL(OpenMeteoClient.URL);
    url.search = new URLSearchParams({
      latitude: points.map((p) => p.lat).join(','),
      longitude: points.map((p) => p.lon).join(','),
      hourly: 'wind_speed_10m,wind_direction_10m,precipitation,temperature_2m',
      wind_speed_unit: 'ms',
      forecast_hours: String(hours),
      timeformat: 'unixtime',
      cell_selection: 'nearest', // без «підлаштування під сушу» — над морем лишаємось над морем
    });
    const body = await this.getJson(url);
    return Array.isArray(body) ? body : [body]; // для однієї точки API повертає обʼєкт, а не масив
  }
}
