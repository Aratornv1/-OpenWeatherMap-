// ШАР 1 — Controller (HTTP-шар). Читає запит, викликає сервіс, формує відповідь.
// Жодної бізнес-логіки: лише «HTTP in → service → HTTP out».
import { AppError } from '../errors.js';

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createWeatherController({ weatherService }) {
  return async function getWeather(req, res, url) {
    try {
      const data = await weatherService.getWeather(url.searchParams.get('city'));
      sendJson(res, 200, data);
    } catch (err) {
      if (err instanceof AppError) return sendJson(res, err.status, { error: err.message });
      console.error(err); // непередбачена помилка — деталі лише в лог, клієнту загальне повідомлення
      sendJson(res, 500, { error: 'Внутрішня помилка сервера.' });
    }
  };
}
