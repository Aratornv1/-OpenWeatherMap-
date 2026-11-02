// Єдине місце, де читаємо змінні середовища (.env). Решта коду отримує готовий config.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig() {
  try {
    process.loadEnvFile(path.join(root, '.env')); // Node 20.12+
  } catch {
    // .env немає — залишаються змінні середовища системи
  }

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('Немає OPENWEATHER_API_KEY. Скопіюй .env.example у .env і встав свій ключ.');
  }

  return {
    apiKey,
    port: Number(process.env.PORT) || 3000,
    publicDir: path.join(root, 'public'),
  };
}
