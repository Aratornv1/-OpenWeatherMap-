// ШАР 1 — Controller (HTTP-шар). Читає запит, викликає сервіс, формує відповідь.
// Жодної бізнес-логіки: лише «HTTP in → service → HTTP out».
import { AppError } from '../errors.js';

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res, err) {
  if (err instanceof AppError) return sendJson(res, err.status, { error: err.message });
  console.error(err); // непередбачена помилка — деталі лише в лог, клієнту загальне повідомлення
  sendJson(res, 500, { error: 'Внутрішня помилка сервера.' });
}

export function createWeatherController({ weatherService }) {
  return async function getWeather(req, res, url) {
    try {
      const { searchParams } = url;
      const data = await weatherService.getWeather(searchParams.get('city'), searchParams.get('country'));
      sendJson(res, 200, data);
    } catch (err) {
      sendError(res, err);
    }
  };
}

// GET /api/wind?hour=N → { hour, hours, time, data: [U, V] } для анімації вітру
export function createWindController({ windService }) {
  return async function getWind(req, res, url) {
    try {
      sendJson(res, 200, await windService.getWindFrame(url.searchParams.get('hour')));
    } catch (err) {
      sendError(res, err);
    }
  };
}

// GET /api/countries → [{ code: 'UA', name: 'Україна' }, …] для випадаючого списку
export function createCountriesController({ weatherService }) {
  return function getCountries(req, res) {
    sendJson(res, 200, weatherService.getCountries());
  };
}

// GET /api/tiles/<layer>/<z>/<x>/<y>.png → PNG-тайл шару погоди (проксі до OpenWeatherMap).
const TILE_ROUTE = /^\/api\/tiles\/([a-z_]+)\/(\d+)\/(\d+)\/(\d+)\.png$/;

export function createTileController({ weatherService }) {
  return async function getTile(req, res, match) {
    try {
      const [, layer, z, x, y] = match;
      const png = await weatherService.getMapTile({ layer, z, x, y });
      // Дані на карті оновлюються рідко — браузер може кешувати тайл 10 хвилин
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600' });
      res.end(png);
    } catch (err) {
      sendError(res, err);
    }
  };
}

export const matchTileRoute = (pathname) => pathname.match(TILE_ROUTE);
