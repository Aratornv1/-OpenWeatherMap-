// Наша власна помилка з HTTP-статусом. Сервіс/клієнт кидають її,
// а контролер перетворює на відповідь. Так шари не знають про HTTP одне одного.
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
