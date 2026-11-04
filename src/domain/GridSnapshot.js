import { ValidationError } from '../errors.js';

// Прогноз по всій сітці, отриманий від Open-Meteo в один момент: для кожної точки масиви за годинами.
// Знає лише про себе: свій вік, який відрізок часу покриває й що було в годину idx.
export class GridSnapshot {
  constructor({ fetchedAt, startSec, hours, speed, dir, precip, temp = [] }) {
    this.fetchedAt = fetchedAt; // мс, коли отримано
    this.startSec = startSec; // UNIX-секунди першої години прогнозу
    this.hours = hours; // скільки годин у прогнозі
    this.speed = speed; // [точка][година] — швидкість вітру, м/с
    this.dir = dir; // [точка][година] — напрямок, ° звідки дме
    this.precip = precip; // [точка][година] — опади за попередню годину, мм
    this.temp = temp; // [точка][година] — температура на 2 м, °C
    Object.freeze(this);
  }

  // Відновлення з JSON (дисковий кеш). Чужий або застарілий формат → null, а не зіпсовані дані.
  static fromJSON(raw) {
    const series = ['speed', 'dir', 'precip', 'temp'];
    if (!raw || !Number.isFinite(raw.fetchedAt) || !Number.isFinite(raw.startSec) || !Number.isInteger(raw.hours)) return null;
    if (!series.every((key) => Array.isArray(raw[key]) && raw[key].length > 0)) return null;
    if (new Set(series.map((key) => raw[key].length)).size !== 1) return null; // однакова кількість точок у всіх рядах
    return new GridSnapshot(raw);
  }

  isFresh(nowMs, ttlMs) {
    return nowMs - this.fetchedAt < ttlMs;
  }

  // Копія, яку вважатимемо свіжою ще retryMs: так не б'ємо по сервісу, що не відповідає, на кожен запит
  postponeRefresh(nowMs, ttlMs, retryMs) {
    return new GridSnapshot({ ...this, fetchedAt: nowMs - ttlMs + retryMs });
  }

  // Година 0 — це «зараз», а не початок кешу: кеш міг бути отриманий кілька годин тому, тому
  // початок зсувається до поточної години. Повертає індекс у масивах і скільки годин лишилось.
  locate(nowMs, hour) {
    const base = Math.max(0, Math.floor((nowMs / 1000 - this.startSec) / 3600));
    const idx = base + hour;
    const available = this.hours - base;
    if (idx >= this.hours) throw new ValidationError(`Прогноз доступний лише на ${available} год.`);
    return { idx, available, time: new Date((this.startSec + idx * 3600) * 1000).toISOString() };
  }
}
