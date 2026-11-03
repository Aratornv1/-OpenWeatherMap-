import { Controller } from './Controller.js';

// GET /api/countries → [{ code: 'UA', name: 'Україна' }, …] для випадаючого списку
export class CountriesController extends Controller {
  #weatherService;

  constructor({ weatherService }) {
    super();
    this.#weatherService = weatherService;
  }

  async respond(req, res) {
    this.sendJson(res, 200, this.#weatherService.getCountries());
  }
}
