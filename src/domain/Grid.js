import { Coordinate } from './Coordinate.js';

// Прямокутна сітка точок над територією. Рядки йдуть з ПІВНОЧІ на південь, колонки із заходу на схід:
// такий порядок вимагає leaflet-velocity, і так само читає значення наш canvas-шар опадів.
export class Grid {
  // Європа: від 72.5°N до 32.5°N і від 25°W до 45°E з кроком 2.5° → 29 × 17 = 493 точки
  static EUROPE = new Grid({ la1: 72.5, la2: 32.5, lo1: -25, lo2: 45, step: 2.5 });

  constructor({ la1, la2, lo1, lo2, step }) {
    this.la1 = la1; // північна межа
    this.la2 = la2; // південна
    this.lo1 = lo1; // західна
    this.lo2 = lo2; // східна
    this.step = step;
    Object.freeze(this);
  }

  get ny() {
    return Math.round((this.la1 - this.la2) / this.step) + 1;
  }

  get nx() {
    return Math.round((this.lo2 - this.lo1) / this.step) + 1;
  }

  get pointCount() {
    return this.nx * this.ny;
  }

  // Усі точки в порядку даних: рядок за рядком, з північного заходу
  points() {
    const points = [];
    for (let r = 0; r < this.ny; r++) {
      for (let c = 0; c < this.nx; c++) {
        points.push(new Coordinate(this.la1 - r * this.step, this.lo1 + c * this.step));
      }
    }
    return points;
  }

  // Опис для клієнта: з нього браузер знає, де лежить кожне значення масиву
  describe() {
    return {
      la1: this.la1, la2: this.la2, lo1: this.lo1, lo2: this.lo2,
      dx: this.step, dy: this.step, nx: this.nx, ny: this.ny,
    };
  }
}
