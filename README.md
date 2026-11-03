# Weather Dashboard

Вибір країни Європи й міста → поточна погода, прогноз на 3 дні та **карта** з шарами погоди й анімованим вітром.
Джерела: OpenWeatherMap (безкоштовний тариф) і Open-Meteo (вітер по сітці, без ключа).

## Запуск

1. Зареєструйся на https://home.openweathermap.org/users/sign_up і скопіюй ключ з розділу **API keys**.
   Новий ключ активується до ~2 годин — до цього буде помилка 401.
2. `copy .env.example .env` і встав ключ у `OPENWEATHER_API_KEY`.
3. `npm start` → http://localhost:3000
4. `npm test` — юніт-тести (без мережі й без ключа).

Після змін у коді сервер треба **перезапустити**: Node сам не перезавантажується.
Карта підтягує Leaflet і `leaflet-velocity` з CDN (потрібен інтернет).

## Можливості

- **Країна + місто.** Список із 45 країн Європи, запит іде як `Paris,FR`. «Будь-яка країна» — пошук без обмеження.
- **Карта.** Темна підкладка OpenStreetMap, маркер міста, кнопки шарів: опади (зараз), хмари, вітер (кольори), температура, тиск (тайли OpenWeatherMap).
- **Анімований вітер** над Європою (частинки) з повзунком часу на 72 години й кнопкою ▶. Дані — Open-Meteo.
- **Опади (прогноз)** — плавна кольорова карта опадів у мм/год із легендою, той самий повзунок часу. Дані — Open-Meteo
  (власний canvas-шар `public/precipitationLayer.js`: інтерполяція між вузлами сітки 2.5°).

## Патерн: шарова архітектура + класи + ін'єкція залежностей

```
браузер ─▶ Router ─▶ Controller ─▶ Service ─▶ Client ─▶ OpenWeatherMap (/weather, /forecast, тайли)
 (public)  (HTTP)    (HTTP)        (логіка)   (Adapter)  Open-Meteo (вітер і опади по сітці)
```

Бекенд і фронтенд написано на **класах** (ООП-версія, гілка `refactor-oop`): доменні класи (value object-и), абстрактні
базові класи з наслідуванням, ін'єкція залежностей через конструктор. Поведінка API не змінилась.

| Шар | Файли | Відповідальність | Чого НЕ знає |
|---|---|---|---|
| Router | `src/http/Router.js` | за шляхом обирає обробника; не-GET → 405; некоректний URL → 400 | що роблять контролери |
| Controller | `src/controllers/Controller.js` (абстрактний) + `WeatherController`, `CountriesController`, `TileController`, `FrameController` | шаблонний метод: `handle()` ловить помилки, нащадок пише лише `respond()` | бізнес-логіки |
| Service | `src/services/WeatherService.js` | створює `CityQuery`/`TileRequest`, збирає `Weather` | HTTP, URL провайдера |
| Service | `src/services/GridService.js` | кеш сітки на 3 год (`GridSnapshot`), кадри вітру й опадів (`WindFrame`, `PrecipitationFrame`) | HTTP, URL Open-Meteo |
| Client | `src/clients/ApiClient.js` (абстрактний) + `OpenWeatherClient`, `OpenMeteoClient` | загальний алгоритм запиту в предку; URL, ключ і тексти помилок у нащадках | що робити з даними |
| Домен | `src/domain/*` | `CityQuery`, `TileRequest`, `ForecastHour`, `Coordinate`, `CountryRegistry`, `Grid`, `GridSnapshot`, `WindVector`, `ForecastBuilder`, `Weather`, `DailyForecast`, `Frame` (+ нащадки) | мережі |
| Дані | `src/data/europeCountries.js` | 45 країн Європи: код ISO → назва | — |
| Composition root | `server.js` | створює об'єкти й передає залежності, реєструє маршрути | — |

Допоміжне: `src/AppConfig.js` (читання `.env`), `src/errors.js` (ієрархія `AppError` → `ValidationError` 400, `NotFoundError` 404,
`RateLimitError` 429, `UpstreamError` 502; `ConfigError` для запуску), `src/http/StaticHandler.js`, `src/http/WeatherApp.js`.

Фронтенд (`public/app.js`): `WeatherApi`, `WeatherView`, `CountrySelect`, `SearchHistory`, `Timeline`, `LayerSwitcher`, `Legend`,
`WeatherMap`, абстрактний `LayerSource` з нащадками `TileSource` / `FrameSource` (→ `WindSource`, `PrecipitationSource`) і `App`.

**Навіщо так:**
- Заміниш провайдера — міняєш лише `Client`; сервіс, контролер і фронтенд не чіпаєш.
- Залежності приходять у конструктор (`new WeatherService({ client })`), тому в тестах підставляється фейковий клієнт — тести без мережі.
  Так само підставляються `fetchFn` у клієнтах, `now` і `sleep` у сервісах, щоб не чекати кеш і паузи.
- Помилки: клієнти й сервіси кидають підклас `AppError` (статус уже вшито в клас), `Controller.sendError` єдиний перетворює їх на HTTP-відповідь.
- Нову відповідь API описує `toJSON()` доменного класу: `JSON.stringify` викликає його сам, і порядок полів зафіксовано в одному місці.

**З чого розбирати код (порядок):** `server.js` → `Router` → `Controller` → `Service` → `Client` → `domain` → `test`.
Розбір із поясненнями: `guide.html` (відкрий у браузері).

## Тести

`npm test` — 100 тестів (було 20), без мережі й без ключа: `errors`, `AppConfig`, доменні класи, клієнти з підробленим `fetch`,
сервіси, контролери/Router/StaticHandler з підробленими `req`/`res` і `WeatherApp` на вільному порту.

## Ключ API
Лише в `.env` на сервері (`.env` у `.gitignore`), браузер його ніколи не бачить. Тайли карти теж йдуть
через наш проксі `/api/tiles/...`: сервер сам додає `appid`, а шар і координати тайла перевіряє за білим списком.

## Маршрути

| Маршрут | Що повертає |
|---|---|
| `GET /api/weather?city=Kyiv&country=UA` | погода + прогноз (наш DTO), `country` необов'язковий |
| `GET /api/countries` | `[{ "code": "UA", "name": "Україна" }, …]` |
| `GET /api/tiles/{layer}/{z}/{x}/{y}.png` | PNG-тайл шару (`precipitation_new`, `clouds_new`, `wind_new`, `temp_new`, `pressure_new`) |
| `GET /api/wind?hour=N` | `{ hour, hours, time, data: [U, V] }` для анімації вітру; `N=0` — поточна година |
| `GET /api/precipitation?hour=N` | `{ hour, hours, time, grid, values }`: опади мм/год по сітці (рядки з півночі на південь) |

Формат `/api/weather` (наш DTO):
```json
{ "city": "Kyiv", "country": "UA", "description": "ясно", "icon": "01d",
  "temp": 10.4, "feelsLike": 9, "humidity": 60, "pressure": 1012, "windSpeed": 3,
  "coord": { "lat": 50.43, "lon": 30.52 },
  "forecast": [{ "date": "2026-11-03", "min": 2, "max": 8, "humidity": 80, "icon": "01d", "description": "дощ" }] }
```

## Ліміти й умови

- **Open-Meteo** безкоштовний лише для **некомерційного** використання: 600 викликів/хв, 10 000/добу, і кожна точка запиту — окремий виклик.
  Сітка (493 точки) кешується в памʼяті на 3 години й ділиться між вітром та опадами: один набір запитів дає обидва шари.
  Кожен перезапуск сервера скидає кеш і витрачає ≈493 виклики.
- **OpenWeatherMap** (безкоштовний тариф): 60 запитів на хвилину.
- Підкладка — стандартні тайли OpenStreetMap: їхня політика допускає лише помірне використання.
