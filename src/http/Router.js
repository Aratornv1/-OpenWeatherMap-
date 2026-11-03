// Маршрутизатор: за шляхом запиту обирає обробника (контролер) і викликає його handle(req, res, ctx).
// Нічого не знає про те, що саме роблять контролери: працює з будь-яким обʼєктом, який має handle.
export class Router {
  #routes = [];
  #fallback;

  // fallback — обробник для всього, що не збіглося з маршрутами (у нас це роздача статичних файлів)
  constructor({ fallback }) {
    this.#fallback = fallback;
  }

  // pattern: рядок (точний збіг) або RegExp (групи потрапляють у ctx.params). Повертає this: можна ланцюжком.
  get(pattern, controller) {
    this.#routes.push({ pattern, controller });
    return this;
  }

  #match(pathname) {
    for (const { pattern, controller } of this.#routes) {
      if (typeof pattern === 'string') {
        if (pattern === pathname) return { controller, params: [] };
      } else {
        const m = pathname.match(pattern);
        if (m) return { controller, params: m.slice(1) };
      }
    }
    return null;
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method !== 'GET') return void res.writeHead(405).end();
      const { controller, params } = this.#match(url.pathname) ?? { controller: this.#fallback, params: [] };
      await controller.handle(req, res, { url, params });
    } catch (err) {
      // Страховка: контролери ловлять свої помилки самі, але некоректний запит (напр., дивний Host) не має валити сервер
      console.error(err);
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  }
}
