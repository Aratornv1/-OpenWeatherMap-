// ШАР 3 — Client (патерн Adapter / Gateway).
// Єдине місце, яке знає, ЯК говорити з OpenWeatherMap: URL, параметри, коди відповідей.
// Повертає «сирий» JSON як є; помилки HTTP перетворює на AppError.
import { AppError } from '../errors.js';

const BASE_URL = 'https://api.openweathermap.org/data/2.5';
const TILE_URL = 'https://tile.openweathermap.org/map'; // Weather Maps 1.0

export function createOpenWeatherClient({ apiKey, fetchFn = fetch }) {
  async function get(url, notFoundMessage) {
    let res;
    try {
      res = await fetchFn(url);
    } catch {
      throw new AppError(502, 'Не вдалося звʼязатися з OpenWeatherMap.');
    }

    if (res.status === 401) {
      throw new AppError(502, 'API-ключ недійсний або ще не активований (до 2 годин після створення).');
    }
    if (res.status === 404) throw new AppError(404, notFoundMessage);
    if (res.status === 429) throw new AppError(429, 'Перевищено ліміт запитів, спробуй пізніше.');
    if (!res.ok) throw new AppError(502, 'Помилка сервісу погоди.');
    return res;
  }

  // country (необовʼязково) — код ISO, звужує пошук: q=Kyiv,UA
  async function request(endpoint, city, country) {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    const q = country ? `${city},${country}` : city;
    url.search = new URLSearchParams({ q, appid: apiKey, units: 'metric', lang: 'ua' });
    const res = await get(url, `Місто «${city}» не знайдено${country ? ` (${country})` : ''}.`);
    return res.json();
  }

  return {
    getCurrent: (city, country) => request('weather', city, country), // поточна погода
    getForecast: (city, country) => request('forecast', city, country), // 5 днів × кожні 3 години

    // Тайл 256×256 PNG з шаром погоди. Ключ додаємо тут, на сервері, — браузер його не бачить.
    async getMapTile(layer, z, x, y) {
      const url = new URL(`${TILE_URL}/${layer}/${z}/${x}/${y}.png`);
      url.search = new URLSearchParams({ appid: apiKey });
      const res = await get(url, 'Тайл не знайдено.');
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
