// Фронтенд лише малює готовий DTO з /api/weather. Уся логіка (мапінг, прогноз на 3 дні) — на сервері.
const $ = (id) => document.getElementById(id);

const form = $('search');
const input = $('city');
const statusEl = $('status');

const iconUrl = (code) => `https://openweathermap.org/img/wn/${code}@2x.png`;
const round = (n) => Math.round(n);

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function renderCurrent(w) {
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

function renderForecast(days) {
  const box = $('days');
  box.replaceChildren(); // createElement + textContent замість innerHTML — без XSS

  for (const d of days) {
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
    box.append(el);
  }
  $('forecast').hidden = days.length === 0;
}

// ── Карта (Leaflet) ─────────────────────────────────────────────
// Підложка — стандартні тайли OpenStreetMap (без ключа), у темній темі через CSS-фільтр.
// Шари погоди бувають двох видів:
//  • тайли-картинки з НАШОГО сервера (/api/tiles/...) — сервер додає API-ключ, у браузері його немає;
//  • анімований вітер: сервер віддає сітку U/V (/api/wind?hour=N), а leaflet-velocity малює частинки.
const WIND_ANIM = 'wind_anim';
const LAYER_HINTS = {
  wind_anim: 'Анімований вітер над Європою (Open-Meteo). Рухай повзунок або натисни ▶ — прогноз на 3 доби.',
  precipitation_new: 'Опади: від світлого (слабкі) до насиченого (сильні).',
  clouds_new: 'Хмарність: чим біліше й щільніше, тим більше хмар.',
  wind_new: 'Швидкість вітру: чим насиченіший колір, тим сильніший вітер.',
  temp_new: 'Температура повітря: холодні тони → теплі.',
  pressure_new: 'Атмосферний тиск: низький та високий — різні кольори.',
};

let map = null;
let marker = null;
let weatherLayer = null; // шар-тайли АБО velocity-шар (одночасно лише один)
let activeLayer = WIND_ANIM;

function makeWeatherLayer(name) {
  return L.tileLayer(`/api/tiles/${name}/{z}/{x}/{y}.png`, { opacity: 0.8, maxNativeZoom: 10, maxZoom: 12 });
}

// ── Анімований вітер: повзунок часу ──
const timeline = $('timeline');
const hourSlider = $('hour');
const playBtn = $('play');
let windSeq = 0; // номер останнього запиту: відповіді-«запізненці» ігноруємо
let playTimer = null;

const formatHour = (iso) =>
  new Date(iso).toLocaleString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  playBtn.textContent = '▶';
  playBtn.setAttribute('aria-label', 'Відтворити');
}

async function loadWindFrame(hour) {
  const seq = ++windSeq;
  // Перший запит за ~3 години заповнює кеш на сервері (кілька порцій до Open-Meteo) — це займає кілька секунд
  if (!weatherLayer) $('map-hint').textContent = 'Завантажую вітер… (перший раз це кілька секунд)';
  try {
    const res = await fetch(`/api/wind?hour=${hour}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Не вдалося завантажити вітер.');
    if (seq !== windSeq || activeLayer !== WIND_ANIM || !map) return; // користувач вже перейшов далі

    hourSlider.max = String(body.hours - 1);
    $('hour-label').textContent = formatHour(body.time);

    if (weatherLayer) {
      weatherLayer.setData(body.data);
    } else {
      weatherLayer = L.velocityLayer({
        data: body.data,
        displayValues: true,
        displayOptions: {
          velocityType: 'Вітер', position: 'bottomleft', emptyString: 'Немає даних',
          angleConvention: 'meteoCW', speedUnit: 'ms', directionString: 'Звідки', speedString: 'Швидкість',
        },
        minVelocity: 0, maxVelocity: 15, velocityScale: 0.01, opacity: 0.9,
      }).addTo(map);
    }
    $('map-hint').textContent = LAYER_HINTS[WIND_ANIM];
  } catch (err) {
    if (seq !== windSeq) return;
    stopPlay();
    $('map-hint').textContent = `Вітер: ${err.message}`;
  }
}

function setLayer(name) {
  activeLayer = name;
  for (const btn of $('layers').children) btn.classList.toggle('active', btn.dataset.layer === name);
  $('map-hint').textContent = LAYER_HINTS[name];
  const isWind = name === WIND_ANIM;
  timeline.hidden = !isWind;
  stopPlay();
  windSeq++; // скасовує відповіді попередніх запитів вітру
  if (!map) return;

  if (weatherLayer) map.removeLayer(weatherLayer);
  weatherLayer = null;
  if (isWind) loadWindFrame(Number(hourSlider.value));
  else weatherLayer = makeWeatherLayer(name).addTo(map);
}

let sliderDebounce = null;
hourSlider.addEventListener('input', () => {
  clearTimeout(sliderDebounce); // не засипаємо сервер запитами, поки рухаєш повзунок
  sliderDebounce = setTimeout(() => loadWindFrame(Number(hourSlider.value)), 200);
});

playBtn.addEventListener('click', () => {
  if (playTimer) return stopPlay();
  playBtn.textContent = '⏸';
  playBtn.setAttribute('aria-label', 'Пауза');
  playTimer = setInterval(() => {
    const next = (Number(hourSlider.value) + 1) % (Number(hourSlider.max) + 1);
    hourSlider.value = String(next);
    loadWindFrame(next);
  }, 1000);
});

function renderMap({ lat, lon, city }) {
  if (typeof L === 'undefined') return; // Leaflet не завантажився (немає інтернету до CDN)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Сервер не повернув координати (перезапусти його).');
  $('map-section').hidden = false; // спершу показуємо блок — Leaflet має знати розмір контейнера

  if (!map) {
    map = L.map('map', { worldCopyJump: true }).setView([lat, lon], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12,
      className: 'base-tiles', // у style.css цей шар затемнюється фільтром
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Погода: <a href="https://openweathermap.org">OpenWeatherMap</a>',
    }).addTo(map);
    marker = L.marker([lat, lon]).addTo(map);
    setLayer(activeLayer);
  } else {
    map.setView([lat, lon], map.getZoom());
    marker.setLatLng([lat, lon]);
  }
  marker.bindTooltip(city);
  map.invalidateSize();
}

$('layers').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-layer]');
  if (btn) setLayer(btn.dataset.layer);
});
setLayer(activeLayer);

// Список країн Європи приходить із сервера (єдине джерело правди). Якщо не вдалось — лишається «Будь-яка країна».
const countrySel = $('country');

async function loadCountries() {
  try {
    const res = await fetch('/api/countries');
    if (!res.ok) throw new Error(String(res.status));
    for (const { code, name } of await res.json()) {
      countrySel.append(new Option(name, code)); // Option → textContent, без innerHTML
    }
    countrySel.value = localStorage.getItem('lastCountry') || '';
  } catch (err) {
    console.warn('Список країн не завантажено:', err.message);
  }
}

async function loadWeather(city, country = '') {
  const button = form.querySelector('button');
  button.disabled = true;
  setStatus('Завантаження…');

  try {
    const params = new URLSearchParams({ city });
    if (country) params.set('country', country);
    const res = await fetch(`/api/weather?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Щось пішло не так.');

    renderCurrent(data);
    renderForecast(data.forecast);
    setStatus('');
    // Карта — додаткова: якщо з нею щось не так, погода й пошук мають працювати далі
    try {
      renderMap({ ...data.coord, city: data.city });
    } catch (mapErr) {
      console.error('Карта не відобразилась:', mapErr);
      $('map-section').hidden = true;
    }
    localStorage.setItem('lastCity', city);
    localStorage.setItem('lastCountry', country);
  } catch (err) {
    $('current').hidden = true;
    $('forecast').hidden = true;
    $('map-section').hidden = true;
    setStatus(err.message, true);
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const city = input.value.trim();
  if (city) loadWeather(city, countrySel.value);
});

loadCountries().then(() => {
  const last = localStorage.getItem('lastCity');
  if (last) {
    input.value = last;
    loadWeather(last, countrySel.value);
  }
});
