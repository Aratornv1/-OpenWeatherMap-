import { Controller } from './Controller.js';

// GET /api/tiles/<layer>/<z>/<x>/<y>.png → PNG-тайл шару погоди (проксі до OpenWeatherMap).
// Ключ додає сервер: у браузері його немає.
export class TileController extends Controller {
  static ROUTE = /^\/api\/tiles\/([a-z_]+)\/(\d+)\/(\d+)\/(\d+)\.png$/;

  #weatherService;

  constructor({ weatherService }) {
    super();
    this.#weatherService = weatherService;
  }

  async respond(req, res, { params }) {
    const [layer, z, x, y] = params; // групи регулярного виразу маршруту
    const png = await this.#weatherService.getMapTile({ layer, z, x, y });
    // Дані на карті оновлюються рідко — браузер може кешувати тайл 10 хвилин
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' });
    res.end(png);
  }
}
