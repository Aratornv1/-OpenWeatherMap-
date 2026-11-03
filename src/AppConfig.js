// Налаштування застосунку. Створюються лише через fromEnv/load і перевіряються при створенні:
// немає ключа — програма не стартує, а не ламається пізніше з 401.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from './errors.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export class AppConfig {
  static PLACEHOLDER_KEY = 'your_api_key_here'; // значення з .env.example

  // Чиста функція від env: у тестах передаємо свій обʼєкт і не чіпаємо process.env
  static fromEnv(env = process.env, publicDir = path.join(ROOT, 'public')) {
    const apiKey = env.OPENWEATHER_API_KEY;
    if (!apiKey || apiKey === AppConfig.PLACEHOLDER_KEY) {
      throw new ConfigError('Немає OPENWEATHER_API_KEY. Скопіюй .env.example у .env і встав свій ключ.');
    }
    return new AppConfig({ apiKey, port: Number(env.PORT) || 3000, publicDir });
  }

  // Для запуску: спершу підвантажує .env (необовʼязковий), потім читає env
  static load() {
    try {
      process.loadEnvFile(path.join(ROOT, '.env')); // Node 20.12+
    } catch {
      // .env немає — залишаються змінні середовища системи
    }
    return AppConfig.fromEnv();
  }

  constructor({ apiKey, port, publicDir }) {
    this.apiKey = apiKey;
    this.port = port;
    this.publicDir = publicDir;
  }
}
