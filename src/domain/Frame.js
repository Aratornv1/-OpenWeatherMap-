// Кадр прогнозу на одну годину. Базовий клас зберігає спільне (година, скільки лишилось, час),
// а нащадки додають свої дані. Контролеру байдуже, який саме кадр: він викликає JSON.stringify,
// а той викликає toJSON нащадка (поліморфізм).
//
//   Frame
//    ├─ WindFrame           — U/V для leaflet-velocity
//    └─ ScalarFrame         — одне число на вузол сітки для canvas-шару
//        ├─ PrecipitationFrame  — опади, мм/год
//        └─ TemperatureFrame    — температура, °C
export class Frame {
  constructor({ hour, hours, time }) {
    if (new.target === Frame) throw new TypeError('Frame is abstract: use WindFrame or PrecipitationFrame');
    this.hour = hour;
    this.hours = hours; // скільки годин прогнозу лишилось
    this.time = time; // ISO-час цієї години
  }

  toJSON() {
    return { hour: this.hour, hours: this.hours, time: this.time };
  }
}

export class WindFrame extends Frame {
  // u, v — масиви компонент вітру по сітці; grid — Grid, з якого вони взяті
  static of(meta, grid, u, v) {
    const header = (parameterNumber, parameterNumberName) => ({
      parameterCategory: 2, parameterNumber, parameterNumberName, parameterUnit: 'm.s-1',
      lo1: grid.lo1, lo2: grid.lo2, la1: grid.la1, la2: grid.la2,
      dx: grid.step, dy: grid.step, nx: grid.nx, ny: grid.ny, refTime: meta.time,
    });
    return new WindFrame(meta, [
      { header: header(2, 'U-component_of_wind'), data: u },
      { header: header(3, 'V-component_of_wind'), data: v },
    ]);
  }

  constructor(meta, data) {
    super(meta);
    this.data = data; // [U, V] у форматі leaflet-velocity
  }

  toJSON() {
    return { ...super.toJSON(), data: this.data };
  }
}

// Кадр «одне число на вузол сітки». Нащадки лише дають назву поля з даними, щоб JSON лишався
// зрозумілим для клієнта: `values` — мм/год для опадів, °C для температури.
export class ScalarFrame extends Frame {
  constructor(meta, grid, values) {
    if (new.target === ScalarFrame) throw new TypeError('ScalarFrame is abstract: use PrecipitationFrame or TemperatureFrame');
    super(meta);
    this.grid = grid; // опис сітки (Grid.describe())
    this.values = values; // число на кожну точку сітки; null — даних немає
  }

  toJSON() {
    return { ...super.toJSON(), grid: this.grid, values: this.values };
  }
}

export class PrecipitationFrame extends ScalarFrame {} // мм за годину

export class TemperatureFrame extends ScalarFrame {} // °C на висоті 2 м
