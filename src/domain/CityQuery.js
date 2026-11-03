import { ValidationError } from '../errors.js';

// Запит «місто + (необовʼязково) країна», який уже пройшов перевірку.
// Створити його можна лише через parse: якщо в руках CityQuery, назва й код країни правильні.
export class CityQuery {
  static MAX_LENGTH = 100;

  static parse(rawCity, rawCountry, countries) {
    const name = String(rawCity ?? '').trim();
    if (!name || name.length > CityQuery.MAX_LENGTH) {
      throw new ValidationError(`Вкажи назву міста (до ${CityQuery.MAX_LENGTH} символів).`);
    }
    return new CityQuery(name, countries.normalize(rawCountry)); // порядок: спершу місто, потім країна
  }

  constructor(name, country) {
    this.name = name;
    this.country = country; // '' — будь-яка
    Object.freeze(this);
  }
}
