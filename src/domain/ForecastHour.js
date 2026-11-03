import { ValidationError } from '../errors.js';

// Номер години прогнозу: 0 — поточна, 1 — наступна і т.д. Ціле невідʼємне число (перевіряється при створенні).
export class ForecastHour {
  static parse(raw) {
    const hour = Number(raw ?? 0);
    if (!Number.isInteger(hour) || hour < 0) throw new ValidationError('Некоректна година прогнозу.');
    return new ForecastHour(hour);
  }

  constructor(value) {
    this.value = value;
    Object.freeze(this);
  }
}
