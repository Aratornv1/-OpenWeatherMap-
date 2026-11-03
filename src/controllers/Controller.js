// ШАР 1 — базовий Controller (HTTP-шар) і «шаблонний метод»: handle() задає порядок (спробувати → помилка у відповідь),
// а нащадок пише лише respond(): що саме відповісти. Жодної бізнес-логіки: «HTTP in → service → HTTP out».
import { AppError } from '../errors.js';

export class Controller {
  constructor() {
    if (new.target === Controller) throw new TypeError('Controller is abstract: use a subclass');
  }

  // ctx = { url, params }: url — розібраний URL запиту, params — групи з регулярного виразу маршруту
  async handle(req, res, ctx) {
    try {
      await this.respond(req, res, ctx);
    } catch (err) {
      this.sendError(res, err);
    }
  }

  // Те, що має написати нащадок
  async respond() {
    throw new Error(`${this.constructor.name} must implement respond()`);
  }

  sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body)); // для обʼєктів із toJSON (Weather, Frame…) форму визначає сам обʼєкт
  }

  sendError(res, err) {
    if (err instanceof AppError) return this.sendJson(res, err.status, { error: err.message });
    console.error(err); // непередбачена помилка — деталі лише в лог, клієнту загальне повідомлення
    this.sendJson(res, 500, { error: 'Внутрішня помилка сервера.' });
  }
}
