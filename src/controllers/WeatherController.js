import { Controller } from './Controller.js';

// GET /api/weather?city=Kyiv&country=UA → Weather (наш DTO)
export class WeatherController extends Controller {
  #weatherService;

  constructor({ weatherService }) {
    super();
    this.#weatherService = weatherService;
  }

  async respond(req, res, { url }) {
    const { searchParams } = url;
    const weather = await this.#weatherService.getWeather(searchParams.get('city'), searchParams.get('country'));
    this.sendJson(res, 200, weather);
  }
}
