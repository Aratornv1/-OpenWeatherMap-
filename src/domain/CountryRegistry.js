import { EUROPE_COUNTRIES } from '../data/europeCountries.js';
import { ValidationError } from '../errors.js';

// Довідник країн: код ISO → назва. Це «білий список»: до зовнішнього API потрапить лише код, який тут є.
// Дані ховаються в приватних полях, ззовні їх читають лише через методи.
export class CountryRegistry {
  #names;
  #list;

  constructor(names) {
    this.#names = Object.freeze({ ...names });
    // Для випадаючого списку: відсортовано за абеткою (українська колація)
    this.#list = Object.freeze(
      Object.entries(names)
        .map(([code, name]) => Object.freeze({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'uk')),
    );
  }

  // Країни Європи (трансконтинентальні не включені)
  static europe() {
    return new CountryRegistry(EUROPE_COUNTRIES);
  }

  list() {
    return this.#list;
  }

  has(code) {
    return Object.hasOwn(this.#names, code);
  }

  // Рядок користувача → код у верхньому регістрі, '' (країну не вказано) або ValidationError
  normalize(raw) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (code && !this.has(code)) throw new ValidationError('Невідома країна.');
    return code;
  }
}
