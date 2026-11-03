// Географічна точка (широта, довгота). Незмінна: після створення поля не змінити.
export class Coordinate {
  constructor(lat, lon) {
    this.lat = lat;
    this.lon = lon;
    Object.freeze(this);
  }

  toJSON() {
    return { lat: this.lat, lon: this.lon };
  }
}
