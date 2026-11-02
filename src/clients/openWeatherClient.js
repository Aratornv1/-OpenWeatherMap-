// ШАР 3 — Client (патерн Adapter / Gateway).
// Єдине місце, яке знає, ЯК говорити з OpenWeatherMap: URL, параметри, коди відповідей.
// Повертає «сирий» JSON як є; помилки HTTP перетворює на AppError.
import { AppError } from '../errors.js';

const BASE_URL = 'https://api.openweathermap.org/data/2.5';

export function createOpenWeatherClient({ apiKey, fetchFn = fetch }) {
  async function request(endpoint, city) {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.search = new URLSearchParams({ q: city, appid: apiKey, units: 'metric', lang: 'ua' });

    let res;
    try {
      res = await fetchFn(url);
    } catch {
      throw new AppError(502, 'Не вдалося звʼязатися з OpenWeatherMap.');
    }

    if (res.status === 401) {
      throw new AppError(502, 'API-ключ недійсний або ще не активований (до 2 годин після створення).');
    }
    if (res.status === 404) throw new AppError(404, `Місто «${city}» не знайдено.`);
    if (res.status === 429) throw new AppError(429, 'Перевищено ліміт запитів, спробуй пізніше.');
    if (!res.ok) throw new AppError(502, 'Помилка сервісу погоди.');

    return res.json();
  }

  return {
    getCurrent: (city) => request('weather', city), // поточна погода
    getForecast: (city) => request('forecast', city), // 5 днів × кожні 3 години
  };
}
