import fs from 'node:fs/promises';
import path from 'node:path';
import { GridSnapshot } from '../domain/GridSnapshot.js';

// Зберігає останній знімок сітки на диск, щоб перезапуск сервера не витрачав ~493 виклики Open-Meteo
// (ліміт 10 000 на добу) і не змушував чекати кілька секунд на перший кадр.
// Кеш лише оптимізація: будь-яка помилка читання чи запису не повинна ламати застосунок.
export class FileSnapshotStore {
  #file;

  constructor(file) {
    this.#file = file;
  }

  // Повертає GridSnapshot або null (файлу нема, він зіпсований або від іншого формату)
  async load() {
    try {
      return GridSnapshot.fromJSON(JSON.parse(await fs.readFile(this.#file, 'utf8')));
    } catch {
      return null;
    }
  }

  async save(snapshot) {
    try {
      await fs.mkdir(path.dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snapshot)); // спершу тимчасовий файл, потім rename: недописаного кешу не буде
      await fs.rename(tmp, this.#file);
    } catch (err) {
      console.warn('Кеш сітки не збережено:', err.message);
    }
  }
}
