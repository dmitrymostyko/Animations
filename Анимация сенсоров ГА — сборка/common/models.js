/* =====================================================================
   3D-модели газоанализаторов «Спецпожинжиниринг» для стартовой страницы.

   1) Загрузка геометрии, встроенной в JS (base64), — чтобы страницы
      открывались из файла (file://) без сервера.
      Формат: Uint32 длина заголовка, JSON {min,max,parts:[{n,l,v,t,big,po,io}]},
      затем для каждой детали — позиции Uint16 (квантованы по общему bbox, мм)
      и индексы Uint16/Uint32.
   2) Сборка моделей:
      СПАРК-БГ  — геометрия из STEP (assets/model_spark_bg.js);
      СПАРК-МИГ — геометрия из STEP (assets/model_spark_mig.js); если файла нет —
                  упрощённая модель по чертежу СПИ.21.00.00.
   Единицы сцены: 1 = 100 мм. Модели стоят сенсорным модулем вниз,
   лицевой стороной к +Z, центр габарита — в начале координат.
   userData.modules — материалы сенсорного модуля (для подсветки).
   ===================================================================== */
(function () {
  'use strict';
  const GA = window.GA = window.GA || {};
  const MM = 0.01;

  GA.decodeModel = function (b64) {
    const bin = atob(b64), n = bin.length, buf = new ArrayBuffer(n), u8 = new Uint8Array(buf);
    for (let i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    const hl = new DataView(buf).getUint32(0, true);
    const hdr = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hl)));
    const base = 4 + hl, mn = hdr.min, mx = hdr.max;
    const sc = [0, 1, 2].map(i => (mx[i] - mn[i]) / 65535);
    const parts = hdr.parts.map(p => {
      const q = new Uint16Array(buf, base + p.po, p.v * 3);
      const pos = new Float32Array(p.v * 3);
      for (let i = 0; i < p.v * 3; i++) pos[i] = mn[i % 3] + q[i] * sc[i % 3];
      const idx = p.big ? new Uint32Array(buf, base + p.io, p.t * 3) : new Uint16Array(buf, base + p.io, p.t * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
      g.computeVertexNormals();
      return { name: p.n, label: p.l, geometry: g };
    });
    return { min: mn, max: mx, parts };
  };

  // Общие материалы (по фото: порошковая окраска, чёрный модуль, нержавейка, стекло)
  function mats() {
    const ds = { side: THREE.DoubleSide };
    const m = {
      orange: new THREE.MeshPhysicalMaterial({ color: 0x9a2f0c, roughness: 0.45, metalness: 0.05, clearcoat: 0.45, clearcoatRoughness: 0.3, envMapIntensity: 0.45 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.5 }),
      blackSoft: new THREE.MeshStandardMaterial({ color: 0x232529, roughness: 0.7, metalness: 0.05 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xc8ced6, roughness: 0.3, metalness: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.4, metalness: 0.2 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x1a2028, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false })
    };
    for (const k in m) if (k !== 'glass') Object.assign(m[k], ds);   // нормали CAD-граней бывают развёрнуты
    return m;
  }

  // Текстура панели за стеклом (рисуется на canvas; логотип — из assets/logo.js)
  function panelTexture(draw) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    const logo = new Image();
    const redraw = () => { g.clearRect(0, 0, 512, 512); draw(g, logo.complete && logo.naturalWidth ? logo : null); t.needsUpdate = true; };
    if (window.GA_LOGO) { logo.onload = redraw; logo.src = window.GA_LOGO.src; }
    redraw();
    return t;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function drawLogo(g, logo, cx, cy, w) {
    if (!logo) return;
    const h = w * logo.naturalHeight / logo.naturalWidth;
    g.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
  }
  /* Лицевая панель СПАРК-МИГ за стеклом — по фото прибора.
     Текстура 512 px = окно ⌀76 мм. Координаты сняты с фото (центр окна, радиус 200 px фото = 256 px текстуры).
     Кнопки — белые кольца с белыми «объёмными» стрелками, эмблема СПИ и надпись — белые,
     дисплей — тёмно-серый прямоугольник, четыре индикатора — серые точки. */
  let emblemCache = null;
  function whiteEmblem(logo) {             // эмблема из логотипа (x 6…416 px из 1814): красное → белое, белые просветы → прозрачные
    if (emblemCache && emblemCache.src === logo.src) return emblemCache.c;
    const sw = Math.round(logo.naturalWidth * 420 / 1814), sh = logo.naturalHeight;
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const g = c.getContext('2d');
    g.drawImage(logo, 0, 0, sw, sh, 0, 0, sw, sh);
    try {
      const d = g.getImageData(0, 0, sw, sh), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const red = Math.max(0, Math.min(1, (p[i] - p[i + 1]) / 140));
        p[i + 3] = p[i + 3] * red; p[i] = 236; p[i + 1] = 238; p[i + 2] = 240;
      }
      g.putImageData(d, 0, 0);
    } catch (e) { /* без доступа к пикселям остаётся цветная эмблема */ }
    emblemCache = { src: logo.src, c };
    return c;
  }
  function drawMigPanel(c, logo) {
    const k = 1.28, X = px => 256 + (px - 222) * k, Y = py => 256 + (py - 230) * k;
    c.fillStyle = '#070809'; c.beginPath(); c.arc(256, 256, 256, 0, 7); c.fill();
    // дисплей
    roundRect(c, X(60), Y(113), (396 - 60) * k, (322 - 113) * k, 5);
    c.fillStyle = '#1b1d20'; c.fill();
    // эмблема и надпись
    if (logo) {
      const em = whiteEmblem(logo), w = 74 * k, h = w * em.height / em.width;
      c.drawImage(em, X(224) - w / 2, Y(64) - h / 2, w, h);
    }
    c.fillStyle = '#eceef0'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '500 ' + Math.round(17 * k) + 'px Segoe UI, Arial'; c.fillText('СПАРК-МИГ', X(224), Y(103));
    // кнопка: белое кольцо, внутри — белая стрелка (треугольная головка + прямоугольный хвост)
    const ring = (x, y, r) => {
      c.fillStyle = '#0b0c0e'; c.beginPath(); c.arc(X(x), Y(y), r * k, 0, 7); c.fill();
      c.strokeStyle = '#eceef0'; c.lineWidth = 2.6 * k; c.stroke();
    };
    const arrow = (x, y, ang) => {
      ring(x, y, 24);
      c.save(); c.translate(X(x), Y(y)); c.rotate(ang); c.scale(k, k);
      c.fillStyle = '#eceef0'; c.beginPath();          // стрелка вверх, затем поворот
      c.moveTo(0, -16); c.lineTo(14, -1); c.lineTo(6, -1); c.lineTo(6, 14);
      c.lineTo(-6, 14); c.lineTo(-6, -1); c.lineTo(-14, -1); c.closePath(); c.fill();
      c.restore();
    };
    arrow(138, 80, Math.PI);            // ↓
    arrow(310, 79, 0);                  // ↑
    arrow(112, 359, -Math.PI / 2);      // ←
    arrow(335, 359, Math.PI / 2);       // →
    // индикаторы
    c.fillStyle = '#2c2f33';
    for (const x of [165, 203, 241, 279]) { c.beginPath(); c.arc(X(x), Y(361), 10.5 * k, 0, 7); c.fill(); }
    // OK
    ring(222, 403, 19);
    c.fillStyle = '#eceef0'; c.font = '600 ' + Math.round(15 * k) + 'px Segoe UI, Arial'; c.fillText('OK', X(222), Y(404));
    c.textBaseline = 'alphabetic';
  }
  function centerAndOrient(grp, rotZ) {
    const root = new THREE.Group();
    root.add(grp);
    grp.rotation.z = rotZ || 0;
    grp.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(grp), c = b.getCenter(new THREE.Vector3());
    grp.position.sub(c);
    root.userData.size = b.getSize(new THREE.Vector3());
    return root;
  }

  /* ---------------- СПАРК-БГ (геометрия из STEP) ---------------- */
  GA.buildSparkBG = function () {
    if (!window.GA_MODELS || !window.GA_MODELS.spark_bg) return null;
    const M = mats();
    const data = GA.decodeModel(window.GA_MODELS.spark_bg);
    const grp = new THREE.Group();
    const modMat = M.black.clone();
    // назначение деталей определено по спецификации чертежа СПИ.22.01.00СБ и габаритам
    const pick = (n, l) => {
      if (n === 'CT100-02' || n === 'CT100-01') return M.orange;                                             // корпус, крышка
      if (n === 'CT100-16' || n === 'CT100-001') return M.steel;                                             // заглушки кабельных вводов (металл, как у СПАРК-МИГ)
      if (n === 'CT100-02-00_ASM' && l === 'CT100-03') return M.glass;                                       // защитное стекло (10 мм)
      if (n === 'CT100-04' || l === 'CT100-06') return M.dark;                                               // фиксатор и подложка дисплея
      if (/^T30-30-(50|70)/.test(n) || /^T30-30-(50|70)/.test(l)) return M.steel;                            // сетка фильтра
      if (/^T30-30/.test(n) || n === 'CT100-03-00_ASM' || /^COMPOUND0(16|20)/.test(n) || l === 'COMPOUND001') return modMat;  // сенсорный модуль
      return M.steel;
    };
    for (const p of data.parts) {
      const m = pick(p.name, p.label);
      const mesh = new THREE.Mesh(p.geometry, m);
      mesh.scale.setScalar(MM);
      if (m === M.glass) mesh.renderOrder = 5;
      grp.add(mesh);
    }
    // панель за стеклом: светодиоды, надпись, ЖК-индикатор, логотип (по фото прибора)
    const tex = panelTexture((g, logo) => {
      g.fillStyle = '#060708'; g.beginPath(); g.arc(256, 256, 256, 0, 7); g.fill();
      const leds = [['Порог 1', '#ff3b2f', 0.35], ['Порог 2', '#ff3b2f', 0.35], ['Авария', '#ffb020', 0.35], ['Норма', '#3be36a', 1]];
      g.font = '17px Segoe UI, Arial'; g.textAlign = 'center';
      leds.forEach(([t, c, a], i) => {
        const x = 135 + i * 80;
        g.globalAlpha = a; g.fillStyle = c; g.beginPath(); g.arc(x, 112, 7, 0, 7); g.fill();
        g.globalAlpha = 1; g.fillStyle = '#9aa3ad'; g.fillText(t, x, 142);
      });
      g.fillStyle = '#e9edf2'; g.font = '600 40px Segoe UI, Arial'; g.fillText('СПАРК-БГ', 256, 196);
      roundRect(g, 136, 220, 240, 110, 6); g.fillStyle = '#101418'; g.fill();
      g.fillStyle = '#2b3a33'; g.font = '600 64px Consolas, monospace'; g.fillText('0', 256, 298);
      g.fillStyle = '#0d0e10'; g.beginPath(); g.arc(256, 372, 14, 0, 7); g.fill();
      drawLogo(g, logo, 256, 430, 150);
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(39, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
    disc.position.set(84 * MM, 70 * MM, 0.25 * MM);    // сразу за стеклом (стекло — z 0…10 мм)
    disc.scale.setScalar(MM);
    disc.rotation.z = Math.PI / 2;            // после поворота прибора текст стоит горизонтально
    grp.add(disc);
    // Шильд заводского номера (поз. 25 по СПИ.22.01.00СБ) — в поднутрении корпуса CT100-02 над крышкой.
    // По STEP: карман 10 × 60 мм (x 23…33, y 40…100), дно z = −28, кромка z = −27;
    // резьбовые отверстия ⌀2,5 под винты М2,5 в точках (28; 44) и (28; 96).
    // Шильд 10 × 60 × 0,8 мм лежит на дне кармана, его отверстия соосны отверстиям корпуса.
    const PL = { x: 28, y: 70, z: -28, w: 10, l: 60, t: 0.8, holes: [44, 96] };
    const pc = document.createElement('canvas'); pc.width = 960; pc.height = 160;
    const pg = pc.getContext('2d');
    const pgr = pg.createLinearGradient(0, 0, 960, 160);
    pgr.addColorStop(0, '#dde1e5'); pgr.addColorStop(0.5, '#babfc5'); pgr.addColorStop(1, '#d4d8dc');
    pg.fillStyle = pgr; pg.fillRect(0, 0, 960, 160);
    pg.strokeStyle = '#8d9399'; pg.lineWidth = 4; pg.strokeRect(2, 2, 956, 156);
    // отверстия шильда: 4 мм от торцов (16 px/мм)
    pg.fillStyle = '#3b4046';
    for (const yh of PL.holes) { pg.beginPath(); pg.arc((yh - (PL.y - PL.l / 2)) * 16, 80, 22, 0, 7); pg.fill(); }
    pg.fillStyle = '#2a2e33'; pg.textAlign = 'center';
    pg.font = '600 42px Segoe UI, Arial'; pg.fillText('Заводской номер СП-022502-003', 480, 66);
    pg.font = '600 40px Segoe UI, Arial'; pg.fillText('ГАЗ: CH₄ 0–100 % НКПР', 480, 124);
    const plateTex = new THREE.CanvasTexture(pc); plateTex.encoding = THREE.sRGBEncoding; plateTex.anisotropy = 4;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(PL.w, PL.l, PL.t), [
      M.steel, M.steel, M.steel, M.steel,
      new THREE.MeshStandardMaterial({ map: plateTex, metalness: 0.5, roughness: 0.4 }), M.steel
    ]);
    // текстура на грани +z ориентирована по x/y — поворачиваем UV на 90°
    const uv = plate.geometry.attributes.uv;
    for (let i = 16; i < 20; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, 1 - u); }
    plate.position.set(PL.x * MM, PL.y * MM, (PL.z + PL.t / 2) * MM);
    plate.scale.setScalar(MM);
    grp.add(plate);
    // винты М2,5 с полукруглой головкой — в отверстиях шильда и корпуса
    const screwMat = new THREE.MeshStandardMaterial({ color: 0xc4cad1, metalness: 0.9, roughness: 0.28, side: THREE.DoubleSide });
    // головка — полусфера ⌀4,5 мм, высота 1,35 мм, разрезанная прорезью шлица 0,6 мм;
    // дно шлица — на половине высоты головки (шлиц утоплен, а не выступает)
    const RH = 2.25, HK = 0.6, SW = 0.35;
    const slotMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0, roughness: 0.95, envMapIntensity: 0.1, side: THREE.DoubleSide });   // стенки и дно шлица — в тени
    // заполнение прорези ниже её дна: сечение головки, обрезанное на высоте дна шлица (½ высоты)
    const fs = new THREE.Shape(), HB = RH * 0.5;
    const xb = Math.sqrt(RH * RH - HB * HB);
    fs.moveTo(-RH, 0); fs.lineTo(RH, 0);
    for (let k = 0; k <= 12; k++) { const x = RH - (RH - xb) * k / 12; fs.lineTo(x, Math.sqrt(Math.max(0, RH * RH - x * x))); }
    fs.lineTo(-xb, HB);
    for (let k = 0; k <= 12; k++) { const x = -xb - (RH - xb) * k / 12; fs.lineTo(x, Math.sqrt(Math.max(0, RH * RH - x * x))); }
    const slotFill = new THREE.ExtrudeGeometry(fs, { depth: 2 * SW, bevelEnabled: false });
    slotFill.translate(0, 0, -SW);
    for (const yh of PL.holes) {
      const head = new THREE.Group();
      for (const sgn of [1, -1]) {
        const half = new THREE.Mesh(new THREE.SphereGeometry(RH, 24, 10, sgn > 0 ? 0 : Math.PI, Math.PI, 0, Math.PI / 2), screwMat);
        half.position.z = sgn * SW;
        const cap = new THREE.Mesh(new THREE.CircleGeometry(RH, 24, 0, Math.PI), slotMat);
        cap.position.z = sgn * SW;
        if (sgn > 0) cap.rotation.y = Math.PI;      // торцы смотрят в прорезь
        head.add(half, cap);
      }
      head.add(new THREE.Mesh(slotFill, slotMat));   // тело головки под дном шлица
      head.rotation.x = Math.PI / 2;
      head.scale.set(MM, MM * HK, MM);
      head.position.set(PL.x * MM, yh * MM, (PL.z + PL.t) * MM);
      grp.add(head);
    }
    const root = centerAndOrient(grp, -Math.PI / 2);
    root.userData.modules = [modMat];
    root.userData.name = 'СПАРК-БГ';
    return root;
  };


  /* ---------------- СПАРК-МИГ (геометрия из STEP) ----------------
     assets/model_spark_mig.js: корпус («СПАРК-МИГ-коробка.stp») и сенсорная часть
     («СПАРК-МИГ-сенсорная часть.stp»), сведённые при экспорте в одну систему (мм):
     x — вправо, y — вверх, z — к зрителю, z = 0 — плоскость стены.
     Сенсорный модуль (трансмиттер) ввёрнут резьбой M25×1,5 в нижний ввод корпуса,
     его ось — x = 0, z = 32,5 мм. Платы, стойки и прокладки внутри не экспортированы. */
  function buildSparkMIGStep() {
    const M = mats();
    const data = GA.decodeModel(window.GA_MODELS.spark_mig);
    const grp = new THREE.Group();
    const modMat = M.black.clone();
    const light = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide });
    const filt = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const inner = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    // световоды — матовый молочный пластик
    const ledGlass = new THREE.MeshStandardMaterial({ color: 0xe6eaec, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const AX = { x: 0, z: 32.5 };                        // ось сенсорного модуля
    let plateMesh = null;
    const pick = (n, l) => {
      if (n === 'box:Коробка' || n === 'box:Крышка') return M.orange;
      if (/^Стекло/.test(l)) return M.glass;
      if (n === 'box:Гайка крышки') return light;        // гайка, прижимающая стекло (светлый ободок за стеклом)
      if (n === 'tr:Корпус трансмиттера' || n === 'tr:Крышка трансмиттера') return modMat;
      if (/^Селективный фильтр/.test(l)) return filt;
      if (/^Светодовод/.test(l)) return ledGlass;
      if (/^Кольцо уплотнительное/.test(l)) return M.blackSoft;
      return inner;                                       // сенсор и направляющая колпачка под решёткой
    };
    for (const p of data.parts) {
      const isPlate = /^Шильд/.test(p.label);
      const m = isPlate ? null : pick(p.name, p.label);
      const mesh = new THREE.Mesh(p.geometry, m || light);
      mesh.scale.setScalar(MM);
      if (m === M.glass) mesh.renderOrder = 5;
      if (isPlate) plateMesh = mesh;
      grp.add(mesh);
      // По STEP в корпусе модуля три радиальных отверстия ⌀5 под световоды (на высоте 46,2 мм,
      // через 15° вокруг оси); световод в STEP стоит только в первом — копируем его в два других
      if (m === ledGlass) for (const k of [1, 2]) {
        const g2 = p.geometry.clone();
        g2.translate(-AX.x, 0, -AX.z); g2.rotateY(-k * Math.PI / 12); g2.translate(AX.x, 0, AX.z);
        const m2 = new THREE.Mesh(g2, ledGlass);
        m2.scale.setScalar(MM);
        grp.add(m2);
      }
    }

    /* шильд сенсорного модуля: цилиндрическая развёртка UV по углу вокруг оси модуля и высоте */
    if (plateMesh) {
      const g = plateMesh.geometry, pos = g.attributes.position, n = pos.count;
      let a0 = 1e9, a1 = -1e9, y0 = 1e9, y1 = -1e9, rs = 0;
      const ang = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = pos.getX(i) - AX.x, z = pos.getZ(i) - AX.z;
        ang[i] = Math.atan2(x, z); rs += Math.hypot(x, z);
        a0 = Math.min(a0, ang[i]); a1 = Math.max(a1, ang[i]);
        y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i));
      }
      const R = rs / n, W = (a1 - a0) * R, H = y1 - y0;   // развёртка, мм
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { uv[2 * i] = (ang[i] - a0) / (a1 - a0); uv[2 * i + 1] = (pos.getY(i) - y0) / H; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const PX = 14, c = document.createElement('canvas');
      c.width = Math.round(W * PX); c.height = Math.round(H * PX);
      const q = c.getContext('2d');
      const gr = q.createLinearGradient(0, 0, 0, c.height);
      gr.addColorStop(0, '#e4e7ea'); gr.addColorStop(1, '#c9cdd2');
      q.fillStyle = gr; q.fillRect(0, 0, c.width, c.height);
      // текст — на лицевой половине шильда (по чертежу СПИ.21.00.00)
      const cx = c.width * (0 - a0) / (a1 - a0), mm = PX;
      q.textAlign = 'center'; q.fillStyle = '#1d4f9c';
      q.font = '600 ' + 3.4 * mm + 'px Segoe UI, Arial'; q.fillText('Модуль сенсорный', cx, 6 * mm);
      q.font = '500 ' + 2.3 * mm + 'px Segoe UI, Arial';
      q.fillText('АО «Спецпожинжиниринг»', cx, 10 * mm);
      q.fillText('СДЕЛАНО В РОССИИ', cx, 13.4 * mm);
      q.font = '600 ' + 2.6 * mm + 'px Segoe UI, Arial'; q.fillText('Искробезопасная цепь', cx, 19.5 * mm);
      const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
      plateMesh.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide });
    }

    /* панель за стеклом (стекло z 119…129 мм, гайка z 111,6…119): окно ⌀76 по чертежу */
    const tex = panelTexture(drawMigPanel);
    /* заглушки неиспользуемых вводов M25×1,5 (п. 7 ТТ чертежа): по два на боковых сторонах и верхний.
       По STEP: оси вводов — y = ±34,3 мм (бока, x = ±61,5) и x = 0 (верх, y = 68,6), глубина z = 32,5 мм */
    const plug = (x, y, dir) => {          // dir — наружная нормаль торца ввода
      const p = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(11.6, 11.6, 10, 40), M.steel);
      shaft.position.y = -5;
      const hex = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 4, 6), M.steel);
      hex.position.y = 2;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(9, 10.5, 1.5, 40), M.steel);
      top.position.y = 4.75;
      p.add(shaft, hex, top);
      p.position.set(x * MM, y * MM, 32.5 * MM);
      p.scale.setScalar(MM);
      p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      grp.add(p);
    };
    for (const sx of [-1, 1]) for (const y of [-34.3, 34.3]) plug(sx * 61.5, y, new THREE.Vector3(sx, 0, 0));
    plug(0, 68.6, new THREE.Vector3(0, 1, 0));

    const back = new THREE.Mesh(new THREE.CircleGeometry(49, 64), new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.8 }));
    back.position.set(0, 0, 110.6 * MM); back.scale.setScalar(MM); grp.add(back);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(38, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
    disc.position.set(0, 0, 110.8 * MM); disc.scale.setScalar(MM); grp.add(disc);

    const root = centerAndOrient(grp, 0);
    root.userData.modules = [modMat];
    root.userData.name = 'СПАРК-МИГ';
    return root;
  }
  /* ---------------- СПАРК-МИГ, запасной вариант без STEP ----------------
     Построен по сборочному чертежу «Сборка 145мм + СЗОх2 + Трансмиттер + Харт-ПОРТ» (СПИ.21.00.00)
     и фото прибора; размеры — в миллиметрах по чертежу. Вариант без СЗО и HART-порта (как на фото).
     Оси: x — вправо, y — вверх, z — к зрителю; z = 0 — плоскость стены (задняя плита). */
  function buildSparkMIGProc() {
    const M = mats();
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, rx, ry, rz) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x * MM, y * MM, z * MM);
      m.rotation.set(rx || 0, ry || 0, rz || 0);
      m.scale.setScalar(MM);
      g.add(m); return m;
    };
    // тело вращения: профиль [r, h]; axis 'z' — ось вдоль z (к зрителю), 'y' — вертикальная
    const lathe = (pts, axis, seg) => {
      const geo = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg || 72);
      if (axis === 'z') geo.rotateX(Math.PI / 2);
      return geo;
    };
    const rrect = (s, x0, y0, x1, y1, r) => {
      s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
      s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1); s.lineTo(x0 + r, y1);
      s.quadraticCurveTo(x0, y1, x0, y1 - r); s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
      return s;
    };
    const slot = (cx, cy, w, h) => {      // продолговатый паз
      const p = new THREE.Path(), r = h / 2;
      p.moveTo(cx - w / 2 + r, cy - r); p.lineTo(cx + w / 2 - r, cy - r);
      p.absarc(cx + w / 2 - r, cy, r, -Math.PI / 2, Math.PI / 2, false);
      p.lineTo(cx - w / 2 + r, cy + r);
      p.absarc(cx - w / 2 + r, cy, r, Math.PI / 2, Math.PI * 1.5, false);
      return p;
    };

    /* задняя монтажная плита 121 × 148 мм с проушинами и пазами 21 × 8,5 мм */
    const pl = new THREE.Shape();
    const W2 = 60.5, H2 = 74, NX = 23, NY = 56, R = 7;
    pl.moveTo(-W2 + R, -H2); pl.lineTo(-NX - R, -H2); pl.quadraticCurveTo(-NX, -H2, -NX, -H2 + R);
    pl.lineTo(-NX, -NY); pl.lineTo(NX, -NY); pl.lineTo(NX, -H2 + R); pl.quadraticCurveTo(NX, -H2, NX + R, -H2);
    pl.lineTo(W2 - R, -H2); pl.quadraticCurveTo(W2, -H2, W2, -H2 + R); pl.lineTo(W2, H2 - R); pl.quadraticCurveTo(W2, H2, W2 - R, H2);
    pl.lineTo(NX + R, H2); pl.quadraticCurveTo(NX, H2, NX, H2 - R); pl.lineTo(NX, NY); pl.lineTo(-NX, NY); pl.lineTo(-NX, H2 - R);
    pl.quadraticCurveTo(-NX, H2, -NX - R, H2); pl.lineTo(-W2 + R, H2); pl.quadraticCurveTo(-W2, H2, -W2, H2 - R);
    pl.lineTo(-W2, -H2 + R); pl.quadraticCurveTo(-W2, -H2, -W2 + R, -H2);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) pl.holes.push(slot(sx * 41.5, sy * 66, 21, 8.5));
    add(new THREE.ExtrudeGeometry(pl, { depth: 7, bevelEnabled: true, bevelSize: 1, bevelThickness: 1, bevelSegments: 2, curveSegments: 10 }), M.orange, 0, 0, 1);

    /* коробка 120 × 104 × 50 мм */
    add(new THREE.ExtrudeGeometry(rrect(new THREE.Shape(), -57, -49, 57, 49, 10), { depth: 44, bevelEnabled: true, bevelSize: 3, bevelThickness: 3, bevelSegments: 3, curveSegments: 10 }), M.orange, 0, 0, 3);

    /* круглая часть корпуса ⌀106 и крышка (общая глубина 145 мм) */
    add(lathe([[0, 46], [50, 46], [55, 50], [55, 62], [53.5, 64], [52.5, 100], [54, 101], [54, 106]], 'z'), M.orange, 0, 0, 0);
    // крышка: обод, скос к окну, утопленное окно ⌀76
    add(lathe([[54, 106], [54, 139], [52, 144], [49, 145], [41, 145], [39.5, 143.5], [38.5, 136], [37, 134], [0, 134]], 'z'), M.orange, 0, 0, 0);
    // 12 приливов по окружности крышки и рёбра на торце
    for (let k = 0; k < 12; k++) {
      const a = (k + 0.5) / 12 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      add(new THREE.BoxGeometry(6, 8, 33), M.orange, c * 55.5, s * 55.5, 124, 0, 0, a);
      add(new THREE.BoxGeometry(11, 4.5, 2.2), M.orange, c * 46, s * 46, 145.6, 0, 0, a);
    }
    // стопорные винты на торце крышки
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      add(new THREE.CylinderGeometry(2.6, 2.6, 1.2, 18), M.dark, Math.cos(a) * 43, Math.sin(a) * 43, 145.2, Math.PI / 2, 0, 0);
    }
    // светлый ободок за стеклом (как на фото) и стекло
    add(new THREE.RingGeometry(36, 38.6, 64), new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.4, metalness: 0.3 }), 0, 0, 134.3);
    add(new THREE.CircleGeometry(38.5, 64), M.glass, 0, 0, 141).renderOrder = 5;

    /* панель за стеклом — раскладка по чертежу (окно ⌀76 мм = 512 px) */
    const tex = panelTexture(drawMigPanel);
    add(new THREE.CircleGeometry(38, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }), 0, 0, 134.5);

    /* вводы M25×1,5: по два на боковых сторонах (заглушены) */
    const ZE = 25;
    for (const sx of [-1, 1]) for (const y of [34.5, -34.2]) {
      add(new THREE.CylinderGeometry(15, 15, 7, 48), M.orange, sx * 63, y, ZE, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(11.5, 11.5, 2, 6), M.steel, sx * 67.5, y, ZE, Math.PI / 6, 0, Math.PI / 2);
    }
    /* горловины сверху (заглушена) и снизу (сенсорный модуль); ось модуля z = 40 */
    const ZM = 40;
    add(new THREE.CylinderGeometry(18, 18, 16, 48), M.orange, 0, 59, ZM);
    add(new THREE.CylinderGeometry(13, 13, 3, 6), M.steel, 0, 68, ZM);
    add(new THREE.CylinderGeometry(18, 18, 16, 48), M.orange, 0, -59, ZM);

    /* сенсорный модуль ⌀66 мм (чёрный); низ — решётка ⌀53 с сетчатыми окнами и колпачок штуцера */
    const modMat = M.black.clone();
    add(new THREE.CylinderGeometry(18.6, 18.6, 7, 6), modMat, 0, -70.5, ZM);            // гайка
    add(lathe([[0, 0], [31, 0], [33, -1.5], [33, -40], [32, -41.5], [32, -43], [33, -44.5], [33, -73], [31.5, -75], [0, -75]], 'y'), modMat, 0, -74, ZM);
    // овальное окно индикации и три светодиода на нижней секции
    const ov = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40), M.dark);
    ov.scale.set(10.5 * MM, 1.2 * MM, 4 * MM); ov.rotation.x = Math.PI / 2; ov.position.set(0, -132 * MM, (ZM + 32.6) * MM);
    g.add(ov);
    for (let k = 0; k < 3; k++) {
      const a = 0.62 + k * 0.13;
      add(new THREE.SphereGeometry(2.1, 16, 10), M.steel, 33 * Math.sin(a), -132, ZM + 33 * Math.cos(a));
    }
    // решётка: основа и четыре окна с сеткой
    add(new THREE.CylinderGeometry(26.5, 27.5, 20, 48), modMat, 0, -159, ZM);
    const mc = document.createElement('canvas'); mc.width = mc.height = 128;
    const mg = mc.getContext('2d'); mg.fillStyle = '#8a9097'; mg.fillRect(0, 0, 128, 128);
    mg.fillStyle = '#16181b';
    for (let y = 0; y < 128; y += 6) for (let x = 0; x < 128; x += 6) mg.fillRect(x, y, 4, 4);
    const meshTex = new THREE.CanvasTexture(mc); meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping; meshTex.repeat.set(3, 2);
    const grille = new THREE.MeshStandardMaterial({ map: meshTex, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide });
    for (let k = 0; k < 4; k++) {
      const a0 = k / 4 * Math.PI * 2 + 0.25;
      add(new THREE.CylinderGeometry(27.6, 27.6, 13, 16, 1, true, a0, Math.PI * 2 / 4 - 0.5), grille, 0, -159, ZM);
    }
    add(lathe([[0, 0], [27, 0], [27, -2], [24, -3.5], [0, -3.5]], 'y'), modMat, 0, -169, ZM);
    // колпачок калибровочного штуцера
    add(new THREE.CylinderGeometry(5, 5, 9, 24), M.blackSoft, 0, -177, ZM);
    add(new THREE.SphereGeometry(5, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.blackSoft, 0, -181.5, ZM);

    const root = centerAndOrient(g, 0);
    root.userData.modules = [modMat];
    root.userData.name = 'СПАРК-МИГ';
    return root;
  }
  GA.buildSparkMIG = function () {
    return window.GA_MODELS && window.GA_MODELS.spark_mig ? buildSparkMIGStep() : buildSparkMIGProc();
  };
})();
