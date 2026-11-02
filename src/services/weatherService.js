// ШАР 2 — Service (бізнес-логіка). Нічого не знає ні про HTTP, ні про URL OpenWeatherMap.
// Залежності (client, now) приходять ззовні → у тестах підставляємо фейки (Dependency Injection).
import { AppError } from '../errors.js';

const DAYS = 3;

// dt — UNIX-секунди (UTC), timezone — зсув міста від UTC у секундах → "YYYY-MM-DD" за місцевим часом.
const localDate = (dt, tz) => new Date((dt + tz) * 1000).toISOString().slice(0, 10);
const localHour = (dt, tz) => new Date((dt + tz) * 1000).getUTCHours();

// Чиста функція (без побічних ефектів) — легко тестувати.
// Прогноз = 40 записів по 3 год. Групуємо по днях міста й беремо 3 дні після сьогоднішнього.
export function buildDailyForecast(forecast, nowMs) {
  const tz = forecast.city.timezone;
  const today = localDate(Math.floor(nowMs / 1000), tz);

  const byDay = new Map();
  for (const item of forecast.list) {
    const day = localDate(item.dt, tz);
    if (day === today) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }

  return [...byDay.entries()].slice(0, DAYS).map(([date, items]) => {
    const temps = items.map((i) => i.main.temp);
    const humidity = items.reduce((sum, i) => sum + i.main.humidity, 0) / items.length;
    // Іконка/опис — із запису, найближчого до полудня
    const noon = items.reduce((best, i) =>
      Math.abs(localHour(i.dt, tz) - 12) < Math.abs(localHour(best.dt, tz) - 12) ? i : best,
    );
    return {
      date,
      min: Math.min(...temps),
      max: Math.max(...temps),
      humidity: Math.round(humidity),
      icon: noon.weather[0].icon.replace('n', 'd'),
      description: noon.weather[0].description,
    };
  });
}

export function createWeatherService({ client, now = Date.now }) {
  return {
    async getWeather(rawCity) {
      const city = String(rawCity ?? '').trim();
      if (!city || city.length > 100) throw new AppError(400, 'Вкажи назву міста (до 100 символів).');

      const [current, forecast] = await Promise.all([client.getCurrent(city), client.getForecast(city)]);

      // Мапимо чужий формат у НАШ (DTO). Фронтенд залежить лише від цієї форми.
      return {
        city: current.name,
        country: current.sys.country,
        description: current.weather[0].description,
        icon: current.weather[0].icon,
        temp: current.main.temp,
        feelsLike: current.main.feels_like,
        humidity: current.main.humidity,
        pressure: current.main.pressure,
        windSpeed: current.wind.speed,
        forecast: buildDailyForecast(forecast, now()),
      };
    },
  };
}
