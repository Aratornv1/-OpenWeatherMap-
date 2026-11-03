import http from 'node:http';

// HTTP-сервер застосунку. Отримує Router у конструкторі й лише віддає йому запити.
export class WeatherApp {
  #router;

  constructor({ router }) {
    this.#router = router;
  }

  listen(port, onListening) {
    return http.createServer((req, res) => this.#router.handle(req, res)).listen(port, onListening);
  }
}
