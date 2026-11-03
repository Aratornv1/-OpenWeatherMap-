import { NotFoundError, RateLimitError, UpstreamError } from '../errors.js';

// ШАР 3 — абстрактний Client (патерн «шаблонний метод»). Тут лежить ЗАГАЛЬНИЙ алгоритм запиту:
//   1. зробити запит;  2. мережа впала → UpstreamError;  3. статус не 2xx → помилка за статусом.
// Те, що різниться між сервісами (як вони називаються і які в них тексти помилок), нащадок дає сам,
// перевизначивши serviceName і errorForStatus.
export class ApiClient {
  #fetchFn;

  // fetchFn передається ззовні: у тестах підставляємо підроблений fetch, мережа не потрібна
  constructor({ fetchFn = fetch } = {}) {
    if (new.target === ApiClient) throw new TypeError('ApiClient is abstract: use a subclass');
    this.#fetchFn = fetchFn;
  }

  // ── Що має дати нащадок ──
  get serviceName() {
    throw new Error(`${this.constructor.name} must define serviceName`);
  }

  // context — те, що знає викликач (наприклад, текст для 404). Базова версія — загальні тексти.
  errorForStatus(status, context = {}) {
    if (status === 404) return new NotFoundError(context.notFoundMessage ?? 'Не знайдено.');
    if (status === 429) return new RateLimitError('Перевищено ліміт запитів, спробуй пізніше.');
    return new UpstreamError(`Помилка сервісу ${this.serviceName}.`);
  }

  // ── Загальний алгоритм ──
  async request(url, context) {
    let res;
    try {
      res = await this.#fetchFn(url);
    } catch (err) {
      throw new UpstreamError(`Не вдалося звʼязатися з ${this.serviceName}.`, { cause: err });
    }
    if (!res.ok) throw this.errorForStatus(res.status, context);
    return res;
  }

  async getJson(url, context) {
    return (await this.request(url, context)).json();
  }

  async getBuffer(url, context) {
    return Buffer.from(await (await this.request(url, context)).arrayBuffer());
  }
}
