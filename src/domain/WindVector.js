// Вектор вітру: u — на схід, v — на північ (м/с). Незмінний value object.
export class WindVector {
  // Метеорологічний напрямок — ЗВІДКИ дме вітер (0° = північний, дме на південь), тому знаки мінус
  static fromMeteo(speed, directionDeg) {
    const rad = (directionDeg * Math.PI) / 180;
    return new WindVector(-speed * Math.sin(rad), -speed * Math.cos(rad));
  }

  constructor(u, v) {
    this.u = u;
    this.v = v;
    Object.freeze(this);
  }
}
