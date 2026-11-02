# Weather Dashboard

Поточна погода + прогноз на 3 дні для будь-якого міста (OpenWeatherMap, безкоштовний тариф).

## Запуск

1. Зареєструйся на https://home.openweathermap.org/users/sign_up і скопіюй ключ з розділу **API keys**.
   Новий ключ активується до ~2 годин — до цього буде помилка 401.
2. `copy .env.example .env` і встав ключ у `OPENWEATHER_API_KEY`.
3. `npm start` → http://localhost:3000
4. `npm test` — юніт-тести сервісу (без мережі й без ключа).

## Патерн: шарова архітектура + ручна Dependency Injection

```
браузер ─▶ Controller ─▶ Service ─▶ Client ─▶ OpenWeatherMap
 (public)  (HTTP)        (логіка)   (Adapter)   (/weather, /forecast)
```

| Шар | Файл | Відповідальність | Чого НЕ знає |
|---|---|---|---|
| Controller | `src/controllers/weatherController.js` | читає запит, викликає сервіс, віддає JSON/статус | бізнес-логіки |
| Service | `src/services/weatherService.js` | валідація, мапінг у наш DTO, прогноз на 3 дні | HTTP, URL OpenWeatherMap |
| Client | `src/clients/openWeatherClient.js` | URL, ключ, коди відповідей → `AppError` | що робити з даними |
| Composition root | `server.js` | створює об'єкти й передає залежності | — |

Допоміжне: `src/config.js` (читання `.env`), `src/errors.js` (`AppError` зі статусом), `src/staticHandler.js`.

**Навіщо так:**
- Заміниш OpenWeatherMap на інший API — міняєш лише `Client`; сервіс, контролер і фронтенд не чіпаєш.
- Залежності приходять аргументами (`createWeatherService({ client })`), тому в `test/weatherService.test.js`
  підставляється фейковий клієнт — тести без мережі.
- Помилки: клієнт/сервіс кидають `AppError(status, msg)`, контролер єдиний перетворює їх на HTTP-відповідь.

**З чого розбирати код (порядок):** `server.js` → `controller` → `service` → `client` → `test`.

## Ключ API
Лише в `.env` на сервері (`.env` у `.gitignore`), браузер його ніколи не бачить.

## Формат відповіді `/api/weather?city=Kyiv` (наш DTO)
```json
{ "city": "Kyiv", "country": "UA", "description": "ясно", "icon": "01d",
  "temp": 10.4, "feelsLike": 9, "humidity": 60, "pressure": 1012, "windSpeed": 3,
  "forecast": [{ "date": "2026-11-03", "min": 2, "max": 8, "humidity": 80, "icon": "01d", "description": "дощ" }] }
```
