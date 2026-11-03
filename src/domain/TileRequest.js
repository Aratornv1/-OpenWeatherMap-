import { ValidationError } from '../errors.js';

// Запит тайла карти, який уже пройшов перевірку: шар із білого списку, а координати плитки
// в межах сітки. У zoom z існує 2^z × 2^z тайлів (x, y від 0 до 2^z − 1).
export class TileRequest {
  static LAYERS = Object.freeze(['clouds_new', 'precipitation_new', 'wind_new', 'temp_new', 'pressure_new']);
  static MAX_ZOOM = 10;

  static parse({ layer, z, x, y }) {
    const [nz, nx, ny] = [z, x, y].map(Number);
    const side = 2 ** nz;
    const ok =
      TileRequest.LAYERS.includes(layer) &&
      Number.isInteger(nz) && nz >= 0 && nz <= TileRequest.MAX_ZOOM &&
      Number.isInteger(nx) && nx >= 0 && nx < side &&
      Number.isInteger(ny) && ny >= 0 && ny < side;
    if (!ok) throw new ValidationError('Некоректний тайл карти.');
    return new TileRequest(layer, nz, nx, ny);
  }

  constructor(layer, z, x, y) {
    this.layer = layer;
    this.z = z;
    this.x = x;
    this.y = y;
    Object.freeze(this);
  }
}
