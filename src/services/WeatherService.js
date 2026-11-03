// ШАР 2 — Service (бізнес-логіка). Нічого не знає ні про HTTP, ні про URL OpenWeatherMap.
// Залежності приходять у конструктор → у тестах підставляємо фейки (ін'єкція залежностей).
import { CityQuery } from '../domain/CityQuery.js';
import { CountryRegistry } from '../domain/CountryRegistry.js';
import { ForecastBuilder } from '../domain/ForecastBuilder.js';
import { TileRequest } from '../domain/TileRequest.js';
import { Weather } from '../domain/Weather.js';

export class WeatherService {
  #client;
  #countries;
  #forecastBuilder;
  #now;

  constructor({ client, countries = CountryRegistry.europe(), forecastBuilder = new ForecastBuilder(), now = Date.now }) {
    this.#client = client;
    this.#countries = countries;
    this.#forecastBuilder = forecastBuilder;
    this.#now = now; // «сьогодні» залежить від годинника: тест фіксує час
  }

  getCountries() {
    return this.#countries.list();
  }

  // Параметри тайла перевіряє TileRequest ДО запиту назовні: довільний шлях до OpenWeatherMap не пройде
  async getMapTile(params) {
    return this.#client.getMapTile(TileRequest.parse(params));
  }

  async getWeather(rawCity, rawCountry) {
    const query = CityQuery.parse(rawCity, rawCountry, this.#countries);

    // Два запити паралельно: сторінка швидша, ніж при послідовних
    const [current, forecast] = await Promise.all([this.#client.getCurrent(query), this.#client.getForecast(query)]);

    return Weather.fromApi(current, this.#forecastBuilder.build(forecast, this.#now()));
  }
}
