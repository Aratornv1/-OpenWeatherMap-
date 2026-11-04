// Фронтенд лише малює готовий DTO з /api/weather. Уся логіка (мапінг, прогноз на 3 дні) — на сервері.
//
// Класи (зверху вниз від дрібного до цілого):
//   WeatherApi      — усі fetch до нашого сервера (єдине місце, що знає URL і формат помилок)
//   WeatherView     — картки «зараз» і «прогноз на 3 дні», рядок статусу
//   SearchHistory   — останнє місто й країна в localStorage
//   CountrySelect   — випадаючий список країн
//   LayerSource     — абстрактне «джерело шару карти»
//    ├─ TileSource        — тайли-картинки з нашого сервера
//    └─ FrameSource       — шар із прогнозом по годинах (абстрактний)
//        ├─ WindSource            — анімований вітер (leaflet-velocity)
//        └─ ScalarFieldSource     — число на вузол сітки (власний canvas-шар) зі своєю палітрою
//            ├─ PrecipitationSource   — опади
//            └─ TemperatureSource     — температура
//   LayerSwitcher   — кнопки вибору шару
//   Legend          — легенда шару з палітрою (опади, температура)
//   Timeline        — повзунок часу і кнопка ▶
//   WeatherMap      — Leaflet-карта, маркер, активний шар, запити кадрів
//   App             — збирає все разом (composition root фронтенду)

const $ = (id) => document.getElementById(id);
const round = (n) => Math.round(n);
const iconUrl = (code) => `https://openweathermap.org/img/wn/${code}@2x.png`;

// ── Обмін з сервером ────────────────────────────────────────────
class WeatherApi {
  // Відповідь сервера — JSON; при помилці в ньому поле error. fallback — текст, якщо його нема.
  async #getJson(url, fallback) {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || fallback);
    return body;
  }

  weather(city, country = '') {
    const params = new URLSearchParams({ city });
    if (country) params.set('country', country);
    return this.#getJson(`/api/weather?${params}`, 'Щось пішло не так.');
  }

  // Кадр прогнозу на годину hour; url і title дає джерело шару
  frame(url, hour, title) {
    return this.#getJson(`${url}?hour=${hour}`, `Не вдалося завантажити: ${title}.`);
  }

  async countries() {
    const res = await fetch('/api/countries');
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
}

// ── Картки погоди ───────────────────────────────────────────────
class WeatherView {
  #status = $('status');

  setStatus(text, isError = false) {
    this.#status.textContent = text;
    this.#status.classList.toggle('error', isError);
  }

  showCurrent(w) {
    $('cur-city').textContent = `${w.city}, ${w.country}`;
    $('cur-desc').textContent = w.description;
    $('cur-temp').textContent = `${round(w.temp)}°C`;
    $('cur-feels').textContent = `${round(w.feelsLike)}°C`;
    $('cur-humidity').textContent = `${w.humidity}%`;
    $('cur-wind').textContent = `${w.windSpeed.toFixed(1)} м/с`;
    $('cur-pressure').textContent = `${w.pressure} гПа`;

    const icon = $('cur-icon');
    icon.src = iconUrl(w.icon);
    icon.alt = w.description;
    $('current').hidden = false;
  }

  showForecast(days) {
    const box = $('days');
    box.replaceChildren(); // createElement + textContent замість innerHTML — без XSS
    for (const d of days) box.append(this.#dayCard(d));
    $('forecast').hidden = days.length === 0;
  }

  #dayCard(d) {
    const el = document.createElement('div');
    el.className = 'day';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('uk-UA', {
      weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC',
    });

    const img = document.createElement('img');
    img.src = iconUrl(d.icon);
    img.alt = d.description;
    img.width = img.height = 70;

    const range = document.createElement('div');
    range.className = 'range';
    range.append(`${round(d.max)}° `);
    const min = document.createElement('span');
    min.textContent = `${round(d.min)}°`;
    range.append(min);

    const hum = document.createElement('div');
    hum.className = 'hum';
    hum.textContent = `Вологість ${d.humidity}%`;

    el.append(name, img, range, hum);
    return el;
  }

  hideAll() {
    $('current').hidden = true;
    $('forecast').hidden = true;
  }
}

// ── Памʼять браузера ────────────────────────────────────────────
class SearchHistory {
  get lastCity() {
    return localStorage.getItem('lastCity');
  }

  get lastCountry() {
    return localStorage.getItem('lastCountry') || '';
  }

  save(city, country) {
    localStorage.setItem('lastCity', city);
    localStorage.setItem('lastCountry', country);
  }
}

// Список країн Європи приходить із сервера (єдине джерело правди). Якщо не вдалось — лишається «Будь-яка країна».
class CountrySelect {
  #select = $('country');
  #api;
  #history;

  constructor({ api, history }) {
    this.#api = api;
    this.#history = history;
  }

  get value() {
    return this.#select.value;
  }

  async load() {
    try {
      for (const { code, name } of await this.#api.countries()) {
        this.#select.append(new Option(name, code)); // Option → textContent, без innerHTML
      }
      this.#select.value = this.#history.lastCountry;
    } catch (err) {
      console.warn('Список країн не завантажено:', err.message);
    }
  }
}

// ── Джерела шарів карти ─────────────────────────────────────────
// Підложка — стандартні тайли OpenStreetMap (без ключа), у темній темі через CSS-фільтр.
// Шари погоди бувають двох видів:
//  • тайли-картинки з НАШОГО сервера (/api/tiles/...) — сервер додає API-ключ, у браузері його немає;
//  • «кадрові» шари з прогнозом по годинах: сервер віддає кадр на годину N, а браузер малює його
//    (вітер — leaflet-velocity, опади й температура — власний canvas-шар). Керує ними повзунок часу.
// WeatherMap працює з будь-яким LayerSource однаково: поліморфізм замість if/else за назвою шару.
class LayerSource {
  constructor(name, hint) {
    if (new.target === LayerSource) throw new TypeError('LayerSource is abstract: use a subclass');
    this.name = name; // значення data-layer кнопки
    this.hint = hint; // підказка під картою
  }

  get isFrame() {
    return false;
  }

  // Палітра для легенди (з FieldPalettes) або null, якщо шар легенди не має
  get palette() {
    return null;
  }

  createLayer() {
    throw new Error(`${this.constructor.name} must implement createLayer()`);
  }
}

class TileSource extends LayerSource {
  createLayer() {
    return L.tileLayer(`/api/tiles/${this.name}/{z}/{x}/{y}.png`, { opacity: 0.8, maxNativeZoom: 10, maxZoom: 12 });
  }
}

class FrameSource extends LayerSource {
  constructor(name, hint, { url, title }) {
    super(name, hint);
    this.url = url; // звідки брати кадр
    this.title = title; // для повідомлень: «Завантажую: вітер…»
  }

  get isFrame() {
    return true;
  }

  load(api, hour) {
    return api.frame(this.url, hour, this.title);
  }

  // body — відповідь сервера (кадр). createLayer створює шар, updateLayer міняє дані в уже створеному.
  updateLayer() {
    throw new Error(`${this.constructor.name} must implement updateLayer()`);
  }
}

class WindSource extends FrameSource {
  constructor() {
    super('wind_anim', 'Анімований вітер над Європою (Open-Meteo). Рухай повзунок або натисни ▶ — прогноз на 3 доби.', {
      url: '/api/wind',
      title: 'вітер',
    });
  }

  createLayer(body) {
    return L.velocityLayer({
      data: body.data,
      displayValues: true,
      displayOptions: {
        velocityType: 'Вітер', position: 'bottomleft', emptyString: 'Немає даних',
        angleConvention: 'meteoCW', speedUnit: 'ms', directionString: 'Звідки', speedString: 'Швидкість',
      },
      minVelocity: 0, maxVelocity: 15, velocityScale: 0.01, opacity: 0.9,
    });
  }

  updateLayer(layer, body) {
    layer.setData(body.data);
  }
}

// Спільне для шарів «одне число на вузол сітки»: різняться вони лише адресою, текстами й палітрою
class ScalarFieldSource extends FrameSource {
  #paletteName;

  constructor(name, hint, { url, title, paletteName }) {
    super(name, hint, { url, title });
    this.#paletteName = paletteName;
  }

  get palette() {
    return window.FieldPalettes[this.#paletteName];
  }

  createLayer(body) {
    return L.scalarFieldLayer(body, this.palette);
  }

  updateLayer(layer, body) {
    layer.setData(body);
  }
}

class PrecipitationSource extends ScalarFieldSource {
  constructor() {
    super('precip_grid', 'Опади за годину (прогноз Open-Meteo, сітка 2.5°). Рухай повзунок або натисни ▶ — прогноз на 3 доби.', {
      url: '/api/precipitation',
      title: 'опади',
      paletteName: 'precipitation',
    });
  }
}

class TemperatureSource extends ScalarFieldSource {
  constructor() {
    super('temp_grid', 'Температура повітря на 2 м (прогноз Open-Meteo, сітка 2.5°). Рухай повзунок або натисни ▶ — прогноз на 3 доби.', {
      url: '/api/temperature',
      title: 'температура',
      paletteName: 'temperature',
    });
  }
}

// ── Елементи керування картою ───────────────────────────────────
class LayerSwitcher {
  #box = $('layers');

  onSelect(handler) {
    this.#box.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-layer]');
      if (btn) handler(btn.dataset.layer);
    });
  }

  setActive(name) {
    for (const btn of this.#box.children) btn.classList.toggle('active', btn.dataset.layer === name);
  }
}

// Легенда шару з палітрою: кольорові «плашки» зі шкали. Будується з палітри (звичайні дані), а не з шару Leaflet,
// тож працює, навіть якщо Leaflet не завантажився. Палітра null → легенду ховаємо.
class Legend {
  #box = $('legend');
  #title = $('legend-title');
  #scale = $('legend-scale');

  show(palette) {
    this.#box.hidden = !palette;
    if (!palette) return;
    this.#title.textContent = palette.title;
    const stops = palette.skipFirstInLegend ? palette.stops.slice(1) : palette.stops;
    const cells = stops.map(([value, r, g, b], i) => {
      const cell = document.createElement('span');
      cell.style.background = `rgb(${r}, ${g}, ${b})`;
      cell.textContent = `${value}${i === stops.length - 1 ? palette.legendSuffix : ''}`;
      return cell;
    });
    this.#scale.replaceChildren(...cells);
  }
}

class Timeline {
  static DEBOUNCE_MS = 200;
  static PLAY_STEP_MS = 1000;

  #box = $('timeline');
  #slider = $('hour');
  #playBtn = $('play');
  #label = $('hour-label');
  #playTimer = null;
  #debounce = null;

  // onChange(hour) — що робити, коли користувач (або ▶) вибрав нову годину
  constructor({ onChange }) {
    this.#slider.addEventListener('input', () => {
      clearTimeout(this.#debounce); // не засипаємо сервер запитами, поки рухаєш повзунок
      this.#debounce = setTimeout(() => onChange(this.hour), Timeline.DEBOUNCE_MS);
    });

    this.#playBtn.addEventListener('click', () => {
      if (this.#playTimer) return this.stop();
      this.#playBtn.textContent = '⏸';
      this.#playBtn.setAttribute('aria-label', 'Пауза');
      this.#playTimer = setInterval(() => {
        const next = (this.hour + 1) % (Number(this.#slider.max) + 1);
        this.#slider.value = String(next);
        onChange(next);
      }, Timeline.PLAY_STEP_MS);
    });
  }

  static #formatHour(iso) {
    return new Date(iso).toLocaleString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  get hour() {
    return Number(this.#slider.value);
  }

  setVisible(visible) {
    this.#box.hidden = !visible;
  }

  // hours — скільки годин прогнозу лишилось, time — ISO-час поточного кадру
  update(hours, time) {
    this.#slider.max = String(hours - 1);
    this.#label.textContent = Timeline.#formatHour(time);
  }

  stop() {
    clearInterval(this.#playTimer);
    this.#playTimer = null;
    this.#playBtn.textContent = '▶';
    this.#playBtn.setAttribute('aria-label', 'Відтворити');
  }
}

// ── Карта (Leaflet) ─────────────────────────────────────────────
class WeatherMap {
  #api;
  #sources; // Map: назва шару → LayerSource
  #timeline;
  #switcher;
  #legend;
  #section = $('map-section');
  #hint = $('map-hint');
  #map = null;
  #marker = null;
  #layer = null; // шар-тайли АБО velocity/canvas-шар (одночасно лише один)
  #active;
  #frameSeq = 0; // номер останнього запиту кадру: відповіді-«запізненці» ігноруємо

  constructor({ api, sources, initial, timeline, switcher, legend }) {
    this.#api = api;
    this.#sources = new Map(sources.map((s) => [s.name, s]));
    this.#active = initial;
    this.#timeline = timeline;
    this.#switcher = switcher;
    this.#legend = legend;
    switcher.onSelect((name) => this.setLayer(name));
  }

  get #source() {
    return this.#sources.get(this.#active);
  }

  hide() {
    this.#section.hidden = true;
  }

  setLayer(name) {
    this.#active = name;
    const source = this.#source;
    this.#switcher.setActive(name);
    this.#hint.textContent = source.hint;
    this.#timeline.setVisible(source.isFrame);
    this.#legend.show(source.palette);
    this.#timeline.stop();
    this.#frameSeq++; // скасовує відповіді попередніх запитів
    if (!this.#map) return;

    if (this.#layer) this.#map.removeLayer(this.#layer);
    this.#layer = null;
    if (source.isFrame) this.loadFrame(this.#timeline.hour);
    else this.#layer = source.createLayer().addTo(this.#map);
  }

  async loadFrame(hour) {
    const source = this.#source;
    const seq = ++this.#frameSeq;
    // Перший запит за ~3 години заповнює кеш на сервері (кілька порцій до Open-Meteo) — це займає кілька секунд
    if (!this.#layer) this.#hint.textContent = `Завантажую: ${source.title}… (перший раз це кілька секунд)`;
    try {
      const body = await source.load(this.#api, hour);
      if (seq !== this.#frameSeq || this.#source !== source || !this.#map) return; // користувач вже перейшов далі

      this.#timeline.update(body.hours, body.time);
      if (this.#layer) source.updateLayer(this.#layer, body);
      else this.#layer = source.createLayer(body).addTo(this.#map);
      this.#hint.textContent = source.hint;
    } catch (err) {
      if (seq !== this.#frameSeq) return;
      this.#timeline.stop();
      this.#hint.textContent = `${source.title[0].toUpperCase()}${source.title.slice(1)}: ${err.message}`;
    }
  }

  // Показує карту в точці міста. Кидає помилку, якщо координат нема: App сам вирішує, що з цим робити.
  show({ lat, lon, city }) {
    if (typeof L === 'undefined') return; // Leaflet не завантажився (немає інтернету до CDN)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Сервер не повернув координати (перезапусти його).');
    this.#section.hidden = false; // спершу показуємо блок — Leaflet має знати розмір контейнера

    if (!this.#map) {
      this.#map = L.map('map', { worldCopyJump: true }).setView([lat, lon], 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        className: 'base-tiles', // у style.css цей шар затемнюється фільтром
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Погода: <a href="https://openweathermap.org">OpenWeatherMap</a>',
      }).addTo(this.#map);
      this.#marker = L.marker([lat, lon]).addTo(this.#map);
      this.setLayer(this.#active);
    } else {
      this.#map.setView([lat, lon], this.#map.getZoom());
      this.#marker.setLatLng([lat, lon]);
    }
    this.#marker.bindTooltip(city);
    this.#map.invalidateSize();
  }
}

// ── Збірка ──────────────────────────────────────────────────────
class App {
  #form = $('search');
  #input = $('city');
  #api = new WeatherApi();
  #view = new WeatherView();
  #history = new SearchHistory();
  #countries = new CountrySelect({ api: this.#api, history: this.#history });
  #map;

  constructor() {
    // Ін'єкція залежностей: Timeline не знає про карту, а карта — про DOM повзунка; їх зв'язує тільки колбек
    const timeline = new Timeline({ onChange: (hour) => this.#map.loadFrame(hour) });
    const legend = new Legend();
    this.#map = new WeatherMap({
      api: this.#api,
      sources: [
        new WindSource(),
        new PrecipitationSource(),
        new TemperatureSource(),
        new TileSource('precipitation_new', 'Опади зараз (OpenWeatherMap): від світлого (слабкі) до насиченого (сильні).'),
        new TileSource('clouds_new', 'Хмарність: чим біліше й щільніше, тим більше хмар.'),
        new TileSource('wind_new', 'Швидкість вітру: чим насиченіший колір, тим сильніший вітер.'),
        new TileSource('temp_new', 'Температура повітря: холодні тони → теплі.'),
        new TileSource('pressure_new', 'Атмосферний тиск: низький та високий — різні кольори.'),
      ],
      initial: 'wind_anim',
      timeline,
      switcher: new LayerSwitcher(),
      legend,
    });
  }

  start() {
    this.#map.setLayer('wind_anim'); // підказка й повзунок видно ще до першого пошуку; карти ще нема
    this.#form.addEventListener('submit', (e) => {
      e.preventDefault();
      const city = this.#input.value.trim();
      if (city) this.search(city, this.#countries.value);
    });

    this.#countries.load().then(() => {
      const last = this.#history.lastCity;
      if (last) {
        this.#input.value = last;
        this.search(last, this.#countries.value);
      }
    });
  }

  async search(city, country = '') {
    const button = this.#form.querySelector('button');
    button.disabled = true;
    this.#view.setStatus('Завантаження…');

    try {
      const data = await this.#api.weather(city, country);
      this.#view.showCurrent(data);
      this.#view.showForecast(data.forecast);
      this.#view.setStatus('');
      // Карта — додаткова: якщо з нею щось не так, погода й пошук мають працювати далі
      try {
        this.#map.show({ ...data.coord, city: data.city });
      } catch (mapErr) {
        console.error('Карта не відобразилась:', mapErr);
        this.#map.hide();
      }
      this.#history.save(city, country);
    } catch (err) {
      this.#view.hideAll();
      this.#map.hide();
      this.#view.setStatus(err.message, true);
    } finally {
      button.disabled = false;
    }
  }
}

new App().start();
