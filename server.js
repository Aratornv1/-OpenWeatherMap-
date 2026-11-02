// Composition root: єдине місце, де «збираємо» застосунок і звʼязуємо шари між собою.
//   HTTP → controller → service → client → OpenWeatherMap
import http from 'node:http';
import { loadConfig } from './src/config.js';
import { createOpenWeatherClient } from './src/clients/openWeatherClient.js';
import { createWeatherService } from './src/services/weatherService.js';
import { createWeatherController } from './src/controllers/weatherController.js';
import { createStaticHandler } from './src/staticHandler.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Dependency Injection вручну: кожен шар отримує те, що йому потрібно, через аргументи.
const client = createOpenWeatherClient({ apiKey: config.apiKey });
const weatherService = createWeatherService({ client });
const getWeather = createWeatherController({ weatherService });
const serveStatic = createStaticHandler(config.publicDir);

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method !== 'GET') return void res.writeHead(405).end();
    if (url.pathname === '/api/weather') return void getWeather(req, res, url);
    serveStatic(req, res, url);
  })
  .listen(config.port, () => console.log(`Weather Dashboard: http://localhost:${config.port}`));
