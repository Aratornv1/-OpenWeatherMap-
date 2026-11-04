// Canvas-шар для Leaflet, що малює ОДНЕ число на вузол сітки (опади, температура) плавною кольоровою картою.
// Отримує кадр { grid, values } із /api/precipitation чи /api/temperature: для кожної точки екрана береться
// її широта/довгота, а значення інтерполюється (білінійно) між чотирма найближчими вузлами сітки 2.5°.
// Так видно плавні плями замість крупних квадратів, і при цьому правильно враховано проєкцію карти.
// Чим саме шар малює (шкала кольорів), вирішує палітра — див. FieldPalettes нижче.

// Палітри не потребують Leaflet, тому оголошені ДО перевірки `typeof L`: легенда будується з них
// навіть тоді, коли Leaflet не завантажився з CDN.
//   stops — [значення, R, G, B, прозорість 0..1], за зростанням значення; між стопами колір лінійний
//   legendSuffix — що дописати до останньої позначки легенди («20+»)
//   skipFirstInLegend — чи пропустити перший стоп у легенді (для опадів це «0 мм», він прозорий)
window.FieldPalettes = {
  // Шкала як на метеорадарах: від блакитного до фіолетового. 0 мм — повністю прозорий.
  precipitation: {
    title: 'Опади, мм/год',
    legendSuffix: '+',
    skipFirstInLegend: true,
    stops: [
      [0, 120, 190, 255, 0],
      [0.1, 110, 180, 255, 0.35],
      [0.5, 50, 120, 255, 0.65],
      [1, 40, 200, 120, 0.75],
      [2.5, 240, 230, 60, 0.8],
      [5, 255, 150, 30, 0.85],
      [10, 230, 50, 40, 0.9],
      [20, 200, 40, 200, 0.92],
    ],
  },
  // Від фіолетового (сильний мороз) через блакитний і зелений до жовтого, помаранчевого й червоного.
  // Весь діапазон видимий (прозорість > 0), бо 0 °C — це теж температура, а не «нічого».
  temperature: {
    title: 'Температура, °C',
    legendSuffix: '',
    skipFirstInLegend: false,
    stops: [
      [-30, 120, 60, 200, 0.75],
      [-20, 80, 100, 230, 0.75],
      [-10, 60, 160, 240, 0.75],
      [0, 150, 220, 240, 0.75],
      [5, 120, 210, 150, 0.75],
      [10, 190, 230, 90, 0.75],
      [15, 250, 230, 70, 0.78],
      [20, 250, 170, 50, 0.8],
      [30, 235, 80, 40, 0.85],
      [40, 170, 30, 60, 0.9],
    ],
  },
};

(() => {
  if (typeof L === 'undefined') return; // Leaflet не завантажився — шар просто не зʼявиться

  // Колір для значення: лінійно між сусідніми «стопами»; за межами шкали — колір крайнього стопа.
  // Повертає [r, g, b, a(0..255)]; для відсутнього значення (null/NaN) — повністю прозорий.
  function colorAt(stops, value) {
    if (!Number.isFinite(value)) return [0, 0, 0, 0];
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (value <= first[0]) return [first[1], first[2], first[3], Math.round(first[4] * 255)];
    if (value >= last[0]) return [last[1], last[2], last[3], Math.round(last[4] * 255)];
    let i = 1;
    while (stops[i][0] < value) i++;
    const [v0, r0, g0, b0, a0] = stops[i - 1];
    const [v1, r1, g1, b1, a1] = stops[i];
    const t = (value - v0) / (v1 - v0);
    return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t, (a0 + (a1 - a0) * t) * 255];
  }

  // Значення в довільній точці: інтерполяція між 4 вузлами. Поза сіткою → null; якщо в одному з чотирьох
  // вузлів даних немає (null) — теж null, щоб не вигадувати число. Біля краю сітки (в межах одного кроку)
  // значення плавно «гаснуть» (fade), щоб не було різкого обрізання.
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
    if (![a, b, c, d].every(Number.isFinite)) return null;
    const value = (a * (1 - tc) + b * tc) * (1 - tr) + (c * (1 - tc) + d * tc) * tr;
    const fade = Math.min(1, fr, fc, ny - 1 - fr, nx - 1 - fc);
    return { value, fade };
  }

  const normalizeLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180; // карта може бути прокручена за 180°

  L.ScalarFieldLayer = L.Layer.extend({
    // palette — один з FieldPalettes; step — розмір «клітинки» вибірки в пікселях
    options: { pane: 'overlayPane', step: 4, palette: null },

    initialize(frame, options) {
      L.setOptions(this, options);
      if (!this.options.palette) throw new Error('ScalarFieldLayer: потрібна palette');
      this._frame = frame;
    },

    setData(frame) {
      this._frame = frame;
      this._draw();
    },

    onAdd(map) {
      this._canvas = L.DomUtil.create('canvas', 'field-canvas leaflet-zoom-hide'); // ховається на час зуму
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
      const { step, palette } = this.options;
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
          const [r, g, b, a] = colorAt(palette.stops, s.value);
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

  L.scalarFieldLayer = (frame, palette, options) => new L.ScalarFieldLayer(frame, { ...options, palette });
})();
