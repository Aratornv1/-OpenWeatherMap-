// Canvas-шар опадів для Leaflet. Отримує кадр { grid, values } із /api/precipitation
// і малює плавну кольорову карту: для кожної точки екрана береться її широта/довгота,
// а значення інтерполюється (білінійно) між чотирма найближчими вузлами сітки 2.5°.
// Так видно плавні плями замість крупних квадратів, і при цьому правильно враховано проєкцію карти.
(() => {
  if (typeof L === 'undefined') return; // Leaflet не завантажився — шар просто не зʼявиться

  // [мм/год, R, G, B, прозорість 0..1] — шкала як на метеорадарах: від блакитного до фіолетового
  const STOPS = [
    [0, 120, 190, 255, 0],
    [0.1, 110, 180, 255, 0.35],
    [0.5, 50, 120, 255, 0.65],
    [1, 40, 200, 120, 0.75],
    [2.5, 240, 230, 60, 0.8],
    [5, 255, 150, 30, 0.85],
    [10, 230, 50, 40, 0.9],
    [20, 200, 40, 200, 0.92],
  ];

  // Колір для значення мм/год: лінійно між сусідніми «стопами». Повертає [r, g, b, a(0..255)].
  function colorAt(mm) {
    if (!(mm > STOPS[0][0])) return [0, 0, 0, 0];
    const last = STOPS[STOPS.length - 1];
    if (mm >= last[0]) return [last[1], last[2], last[3], Math.round(last[4] * 255)];
    let i = 1;
    while (STOPS[i][0] < mm) i++;
    const [m0, r0, g0, b0, a0] = STOPS[i - 1];
    const [m1, r1, g1, b1, a1] = STOPS[i];
    const t = (mm - m0) / (m1 - m0);
    return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t, (a0 + (a1 - a0) * t) * 255];
  }

  // Значення в довільній точці: інтерполяція між 4 вузлами. Поза сіткою → null.
  // Біля краю сітки (в межах одного кроку) значення плавно «гаснуть», щоб не було різкого обрізання.
  function sample(frame, lat, lon) {
    const { la1, lo1, dx, dy, nx, ny } = frame.grid;
    const fr = (la1 - lat) / dy; // дробовий номер рядка (рядки йдуть з півночі на південь)
    const fc = (lon - lo1) / dx; // дробовий номер колонки
    if (fr < 0 || fc < 0 || fr > ny - 1 || fc > nx - 1) return null;

    const r0 = Math.min(Math.floor(fr), ny - 2);
    const c0 = Math.min(Math.floor(fc), nx - 2);
    const tr = fr - r0;
    const tc = fc - c0;
    const v = frame.values;
    const a = v[r0 * nx + c0];
    const b = v[r0 * nx + c0 + 1];
    const c = v[(r0 + 1) * nx + c0];
    const d = v[(r0 + 1) * nx + c0 + 1];
    const value = (a * (1 - tc) + b * tc) * (1 - tr) + (c * (1 - tc) + d * tc) * tr;
    const fade = Math.min(1, fr, fc, ny - 1 - fr, nx - 1 - fc);
    return { value, fade };
  }

  const normalizeLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180; // карта може бути прокручена за 180°

  L.PrecipitationLayer = L.Layer.extend({
    options: { pane: 'overlayPane', step: 4 }, // step — розмір «клітинки» вибірки в пікселях

    initialize(frame, options) {
      L.setOptions(this, options);
      this._frame = frame;
    },

    setData(frame) {
      this._frame = frame;
      this._draw();
    },

    onAdd(map) {
      this._canvas = L.DomUtil.create('canvas', 'precip-canvas leaflet-zoom-hide'); // ховається на час зуму
      this._canvas.style.pointerEvents = 'none';
      map.getPane(this.options.pane).appendChild(this._canvas);
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
    },

    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      this._canvas.remove();
    },

    // Полотно завжди розміром з видиму частину карти й стоїть у її лівому верхньому куті.
    _reset() {
      const size = this._map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;
      L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]));
      this._draw();
    },

    _draw() {
      if (!this._frame || !this._map) return;
      const { step } = this.options;
      const w = this._canvas.width;
      const h = this._canvas.height;
      const sw = Math.ceil(w / step);
      const sh = Math.ceil(h / step);

      // Малюємо на маленькому «знімку» (одна клітинка = один піксель), потім розтягуємо зі згладжуванням
      const small = document.createElement('canvas');
      small.width = sw;
      small.height = sh;
      const sctx = small.getContext('2d');
      const img = sctx.createImageData(sw, sh);

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const ll = this._map.containerPointToLatLng([x * step + step / 2, y * step + step / 2]);
          const s = sample(this._frame, ll.lat, normalizeLon(ll.lng));
          if (!s) continue;
          const [r, g, b, a] = colorAt(s.value);
          const i = (y * sw + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = a * s.fade;
        }
      }
      sctx.putImageData(img, 0, 0);

      const ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
    },
  });

  L.PrecipitationLayer.STOPS = STOPS;
  L.precipitationLayer = (frame, options) => new L.PrecipitationLayer(frame, options);
})();
