// Ієрархія помилок. Сервіси й клієнти кидають їх, а контролер перетворює на HTTP-відповідь:
// статус уже вшито в клас, тож нижні шари не знають про HTTP-відповіді.
//
//   Error
//    ├─ ConfigError              — неправильні налаштування (лише при старті, не HTTP)
//    └─ AppError (status)
//        ├─ ValidationError  400 — поганий ввід користувача
//        ├─ NotFoundError    404 — місто чи тайл не знайдено
//        ├─ RateLimitError   429 — вичерпано ліміт запитів
//        └─ UpstreamError    502 — проблема на боці зовнішнього API
export class AppError extends Error {
  constructor(message, status, options) {
    super(message, options);
    this.name = new.target.name; // імʼя реального класу: ValidationError, UpstreamError, ...
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message, options) {
    super(message, 400, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message, options) {
    super(message, 404, options);
  }
}

export class RateLimitError extends AppError {
  constructor(message, options) {
    super(message, 429, options);
  }
}

export class UpstreamError extends AppError {
  constructor(message, options) {
    super(message, 502, options);
  }
}

export class ConfigError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ConfigError';
  }
}
