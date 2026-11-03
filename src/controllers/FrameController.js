import { Controller } from './Controller.js';

// Обробник кадру по сітці: GET ...?hour=N → JSON. Один клас обслуговує і вітер, і опади:
// йому передають функцію сервісу, яка повертає Frame (WindFrame чи PrecipitationFrame).
//   /api/wind          → { hour, hours, time, data: [U, V] }
//   /api/precipitation → { hour, hours, time, grid, values }
export class FrameController extends Controller {
  #getFrame;

  constructor(getFrame) {
    super();
    this.#getFrame = getFrame;
  }

  async respond(req, res, { url }) {
    this.sendJson(res, 200, await this.#getFrame(url.searchParams.get('hour')));
  }
}
