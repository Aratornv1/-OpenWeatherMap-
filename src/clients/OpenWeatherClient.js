import { ApiClient } from './ApiClient.js';
import { UpstreamError } from '../errors.js';

// Клієнт OpenWeatherMap (патерн Adapter). Єдине місце, яке знає, ЯК говорити з цим API:
// URL, параметри, ключ, коди відповідей. Повертає «сирий» JSON або байти тайла.
export class OpenWeatherClient extends ApiClient {
  static BASE_URL = 'https://api.openweathermap.org/data/2.5';
  static TILE_URL = 'https://tile.openweathermap.org/map'; // Weather Maps 1.0

  #apiKey;

  constructor({ apiKey, ...options }) {
    super(options); // fetchFn
    this.#apiKey = apiKey; // приватне: ключ не потрапить у лог чи відповідь випадково
  }

  // ── Перевизначення базового класу (поліморфізм) ──
  get serviceName() {
    return 'OpenWeatherMap';
  }

  errorForStatus(status, context) {
    if (status === 401) {
      return new UpstreamError('API-ключ недійсний або ще не активований (до 2 годин після створення).');
    }
    if (status === 404 || status === 429) return super.errorForStatus(status, context);
    return new UpstreamError('Помилка сервісу погоди.');
  }

  // ── Своє ──
  // query — CityQuery ({ name, country }); country (необовʼязково) звужує пошук: q=Kyiv,UA
  async #fetchWeather(endpoint, query) {
    const url = new URL(`${OpenWeatherClient.BASE_URL}/${endpoint}`);
    const q = query.country ? `${query.name},${query.country}` : query.name;
    url.search = new URLSearchParams({ q, appid: this.#apiKey, units: 'metric', lang: 'ua' });
    return this.getJson(url, {
      notFoundMessage: `Місто «${query.name}» не знайдено${query.country ? ` (${query.country})` : ''}.`,
    });
  }

  getCurrent(query) {
    return this.#fetchWeather('weather', query); // поточна погода
  }

  getForecast(query) {
    return this.#fetchWeather('forecast', query); // 5 днів × кожні 3 години
  }

  // Тайл 256×256 PNG з шаром погоди. Ключ додаємо тут, на сервері, — браузер його не бачить.
  async getMapTile(tile) {
    const url = new URL(`${OpenWeatherClient.TILE_URL}/${tile.layer}/${tile.z}/${tile.x}/${tile.y}.png`);
    url.search = new URLSearchParams({ appid: this.#apiKey });
    return this.getBuffer(url, { notFoundMessage: 'Тайл не знайдено.' });
  }
}
