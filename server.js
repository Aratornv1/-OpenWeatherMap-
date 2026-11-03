// Composition root: єдине місце, де «збираємо» застосунок і звʼязуємо класи між собою.
//   HTTP → Router → Controller → Service → Client → OpenWeatherMap / Open-Meteo
import { AppConfig } from './src/AppConfig.js';
import { OpenMeteoClient } from './src/clients/OpenMeteoClient.js';
import { OpenWeatherClient } from './src/clients/OpenWeatherClient.js';
import { CountriesController } from './src/controllers/CountriesController.js';
import { FrameController } from './src/controllers/FrameController.js';
import { TileController } from './src/controllers/TileController.js';
import { WeatherController } from './src/controllers/WeatherController.js';
import { Router } from './src/http/Router.js';
import { StaticHandler } from './src/http/StaticHandler.js';
import { WeatherApp } from './src/http/WeatherApp.js';
import { GridService } from './src/services/GridService.js';
import { WeatherService } from './src/services/WeatherService.js';

let config;
try {
  config = AppConfig.load();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Ін'єкція залежностей вручну: кожен клас отримує те, що йому потрібно, через конструктор.
const weatherService = new WeatherService({ client: new OpenWeatherClient({ apiKey: config.apiKey }) });
const gridService = new GridService({ client: new OpenMeteoClient() });

const router = new Router({ fallback: new StaticHandler(config.publicDir) })
  .get('/api/weather', new WeatherController({ weatherService }))
  .get('/api/countries', new CountriesController({ weatherService }))
  .get(TileController.ROUTE, new TileController({ weatherService }))
  .get('/api/wind', new FrameController((hour) => gridService.getWindFrame(hour)))
  .get('/api/precipitation', new FrameController((hour) => gridService.getPrecipitationFrame(hour)));

new WeatherApp({ router }).listen(config.port, () => console.log(`Weather Dashboard: http://localhost:${config.port}`));
