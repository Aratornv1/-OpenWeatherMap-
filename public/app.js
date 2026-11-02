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

async function loadWeather(city) {
  const button = form.querySelector('button');
  button.disabled = true;
  setStatus('Завантаження…');

  try {
    const res = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Щось пішло не так.');

    renderCurrent(data);
    renderForecast(data.forecast);
    setStatus('');
    localStorage.setItem('lastCity', city);
  } catch (err) {
    $('current').hidden = true;
    $('forecast').hidden = true;
    setStatus(err.message, true);
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const city = input.value.trim();
  if (city) loadWeather(city);
});

const last = localStorage.getItem('lastCity');
if (last) {
  input.value = last;
  loadWeather(last);
}
