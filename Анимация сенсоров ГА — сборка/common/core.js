/* =====================================================================
   Общее ядро анимаций сенсоров газоанализаторов.
   Классические скрипты (без ES-модулей), чтобы страницы открывались
   двойным щелчком из проводника (file://) без локального сервера.
   Требует: lib/three.min.js, lib/OrbitControls.js
   ===================================================================== */
(function () {
  'use strict';
  const GA = (window.GA = {});

  /* ------------------------------------------------------------------
     Сцена, камера, свет, управление камерой, цикл анимации
     ------------------------------------------------------------------ */
  GA.createStage = function (opts = {}) {
    const container = document.getElementById('stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.sortObjects = true;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
    camera.position.copy(opts.cameraPos || new THREE.Vector3(-7, 4.5, 9));

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.copy(opts.target || new THREE.Vector3(0, 0, 0));
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2;
    controls.maxDistance = 40;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x1a1f2a, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(-5, 8, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.45);
    rim.position.set(6, 2, -6);
    scene.add(rim);

    // Окружение для отражений металла: простая градиентная «комната»
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envGeo = new THREE.SphereGeometry(20, 32, 16);
    const envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.05,0.06,0.08), vec3(0.75,0.82,0.95), smoothstep(-0.2,0.9,h)); gl_FragColor = vec4(c,1.); }'
    });
    envScene.add(new THREE.Mesh(envGeo, envMat));
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;

    // Едва заметная сетка-пол для ощущения пространства
    const grid = new THREE.GridHelper(40, 40, 0x2a3a50, 0x1b2636);
    grid.position.y = opts.floorY !== undefined ? opts.floorY : -2.6;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    scene.add(grid);

    const stage = {
      scene, camera, renderer, controls,
      timeScale: 1, paused: false, time: 0,
      _fns: [],
      onFrame(fn) { this._fns.push(fn); }
    };

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Основная сцена + слои поверх неё (например, логотип) со своими камерами
    stage.overlays = [];
    function renderAll() {
      renderer.render(scene, camera);
      if (!stage.overlays.length) return;
      renderer.autoClear = false;
      for (const ov of stage.overlays) { renderer.clearDepth(); renderer.render(ov.scene, ov.camera); }
      renderer.autoClear = true;
    }

    let last = performance.now();
    function loop(now) {
      requestAnimationFrame(loop);
      // метка времени первого кадра rAF может быть раньше performance.now() — шаг не бывает отрицательным
      let dtReal = Math.max(0, Math.min((now - last) / 1000, 0.05));
      last = now;
      const dt = stage.paused ? 0 : dtReal * stage.timeScale;
      stage.time += dt;
      for (const fn of stage._fns) fn(dt, stage.time, dtReal);
      controls.update();
      renderAll();
      if (GA.labels) GA.labels.update(camera);
    }
    requestAnimationFrame(loop);

    // Режим самопроверки (#selftest): прогоняет ~40 с симуляции разом.
    // Нужен для автоматической проверки в браузере без экрана.
    if (location.hash.indexOf('#selftest') === 0) {
      setTimeout(() => {
        for (let i = 0; i < 1200; i++) {
          const dt = (1 / 30) * stage.timeScale;
          stage.time += dt;
          for (const fn of stage._fns) fn(dt, stage.time, 1 / 30);
        }
        controls.update();
        renderAll();
        if (GA.labels) GA.labels.update(camera);
        if (window.__dbg) document.body.setAttribute('data-dbg', window.__dbg());
        // размеры панелей — для проверки, что они не меняются от показаний
        const hr = id => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().height) : 0; };
        { const lc = document.getElementById('leftcol'); document.body.setAttribute('data-sizes', 'controls=' + hr('controls') + ' readout=' + hr('readout') + ' overflow=' + (lc ? lc.scrollHeight - lc.clientHeight : 0)); }
      }, 50);
    }
    return stage;
  };

  /* ------------------------------------------------------------------
     Текстура «свечения» для частиц-спрайтов
     ------------------------------------------------------------------ */
  let _glowTex = null;
  GA.glowTexture = function () {
    if (_glowTex) return _glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    _glowTex = new THREE.CanvasTexture(c);
    return _glowTex;
  };

  /* Текстура сетки пламегасителя (спечённый металл / сетка) */
  GA.meshTexture = function (cells = 26) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 512);
    const step = 512 / cells;
    g.strokeStyle = 'rgba(205,215,228,0.95)';
    g.lineWidth = step * 0.28;
    for (let i = 0; i <= cells; i++) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(512, i * step); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  };

  /* ------------------------------------------------------------------
     Материалы
     ------------------------------------------------------------------ */
  GA.mat = {
    glassShell: () => new THREE.MeshPhysicalMaterial({
      color: 0xb8c6d8, metalness: 0.6, roughness: 0.25,
      transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false
    }),
    metal: (color = 0xb9c2cc) => new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.3 }),
    gold: () => new THREE.MeshStandardMaterial({ color: 0xffc766, metalness: 1.0, roughness: 0.12 }),
    plastic: (color) => new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.55 })
  };

  /* ------------------------------------------------------------------
     Молекулы (заполняющие пространство модели, как на рисунках статьи)
     ------------------------------------------------------------------ */
  const ATOM = {
    H: { r: 0.075, color: 0xf2f4f7 },
    C: { r: 0.12, color: 0x2b2f36 },
    O: { r: 0.11, color: 0xd8302a },
    N: { r: 0.11, color: 0x2f5fd8 },
    Pb: { r: 0.15, color: 0x7d8796 },
    Si: { r: 0.14, color: 0xa77ad0 },
    S: { r: 0.14, color: 0xe3c02a }
  };
  const _atomGeo = new THREE.SphereGeometry(1, 20, 14);
  // Цвет задаётся ЭЛЕМЕНТОМ и одинаков в любой форме — в молекуле, атоме или ионе, во всех анимациях:
  //   H — серое прозрачное стекло; O — прозрачно-голубой; S — среднепрозрачный жёлтый.
  // Элементы без записи здесь — непрозрачные, цвет из ATOM.
  GA.ELEMAT = {
    H: { color: 0x8f989f, opacity: 0.4, roughness: 0.02, metalness: 0.15, emissive: 0x000000, emissiveIntensity: 0, envMapIntensity: 2.2 },
    O: { color: 0x4fb4ff, opacity: 0.45, roughness: 0.15, metalness: 0, emissive: 0x123a5a, emissiveIntensity: 0.35, envMapIntensity: 0.9 },
    S: { color: 0xf5d21e, opacity: 0.58, roughness: 0.25, metalness: 0, emissive: 0x4a3a00, emissiveIntensity: 0.35, envMapIntensity: 1.0 }
  };
  // Насыщенность цветов молекул (1 — исходная). Формула как у CSS saturate(),
  // тем же коэффициентом насыщаются кружки легенды (#mols .dot в style.css)
  GA.molSat = 1.6;
  function sat(c) {
    const k = GA.molSat, col = new THREE.Color(c);
    const y = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
    col.r = THREE.MathUtils.clamp(y + (col.r - y) * k, 0, 1);
    col.g = THREE.MathUtils.clamp(y + (col.g - y) * k, 0, 1);
    col.b = THREE.MathUtils.clamp(y + (col.b - y) * k, 0, 1);
    return col;
  }
  const _atomMat = {};
  // variant: 'dense' — тот же элемент, но плотнее (например, атомы на поверхности катализатора)
  function atomMat(el, variant) {
    const key = el + (variant ? '_' + variant : '');
    if (_atomMat[key]) return _atomMat[key];
    const s = GA.ELEMAT[el];
    if (variant === 'cation' || variant === 'anion') {
      // ион (там, где речь об электрическом поле и зарядах): материал элемента
      // с оттенком — положительный красноватый, отрицательный голубоватый
      const pos = variant === 'cation';
      const base = s ? s : { color: ATOM[el].color, opacity: 1, roughness: 0.45, metalness: 0, envMapIntensity: 0.3 };
      const col = new THREE.Color(base.color).lerp(new THREE.Color(pos ? 0xff4a3a : 0x1f7cff), pos ? 0.55 : 0.75);
      _atomMat[key] = new THREE.MeshStandardMaterial({
        color: sat(col), roughness: base.roughness, metalness: base.metalness || 0,
        emissive: sat(pos ? 0x6a1206 : 0x1a5ab4), emissiveIntensity: pos ? 0.6 : 0.8, envMapIntensity: base.envMapIntensity,
        transparent: base.opacity < 1, opacity: Math.min(1, base.opacity + (pos ? 0.15 : 0.35)), depthWrite: !(base.opacity < 1)
      });
      return _atomMat[key];
    }
    if (s) {
      _atomMat[key] = new THREE.MeshStandardMaterial({
        color: sat(s.color), roughness: s.roughness, metalness: s.metalness, emissive: sat(s.emissive),
        emissiveIntensity: s.emissiveIntensity, envMapIntensity: s.envMapIntensity,
        transparent: true, opacity: variant === 'dense' ? Math.min(0.85, s.opacity * 1.9) : s.opacity, depthWrite: false
      });
    } else {
      _atomMat[key] = new THREE.MeshStandardMaterial({ color: sat(ATOM[el].color), roughness: 0.45, metalness: 0.0, envMapIntensity: 0.3 });
    }
    return _atomMat[key];
  }
  GA.atomMat = atomMat;
  function atom(el, x, y, z, ownMaterial) {
    const m = new THREE.Mesh(_atomGeo, ownMaterial ? atomMat(el).clone() : atomMat(el));
    m.scale.setScalar(ATOM[el].r);
    m.position.set(x, y, z);
    m.userData.el = el;
    m.userData.own = !!ownMaterial;
    if (GA.ELEMAT[el]) m.renderOrder = 2;
    return m;
  }
  GA.ATOM = ATOM;
  GA.molK = 0.5;                  // уменьшение молекул, ионов и электронов (1 — исходный размер)
  GA.molScale = 0.75 * GA.molK;   // общий масштаб молекул относительно сенсора

  // Направления тетраэдра для CH4
  const TET = [
    new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(-1, 1, -1), new THREE.Vector3(-1, -1, 1)
  ].map(v => v.normalize());

  // Координаты атомов в ångström (приближённо); 1 Å = 0,156 ед. модели (как C–H в CH4)
  const XYZ = (function () {
    const tol = [];
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      tol.push(['C', 1.39 * Math.cos(a), 1.39 * Math.sin(a), 0]);
      if (k) tol.push(['H', 2.47 * Math.cos(a), 2.47 * Math.sin(a), 0]);
    }
    tol.push(['C', 2.9, 0, 0], ['H', 3.29, 0.51, 0.89], ['H', 3.29, 0.51, -0.89], ['H', 3.29, -1.02, 0]);
    return {
      IBUT: [['C', 0, 0, 0], ['C', 1.34, 0, 0], ['H', 1.9, 0.93, 0], ['H', 1.9, -0.93, 0],
        ['C', -0.75, 1.3, 0], ['H', -1.8, 1.1, 0], ['H', -0.45, 1.85, 0.89], ['H', -0.45, 1.85, -0.89],
        ['C', -0.75, -1.3, 0], ['H', -1.8, -1.1, 0], ['H', -0.45, -1.85, 0.89], ['H', -0.45, -1.85, -0.89]],
      TOL: tol,
      ACET: [['C', 0, 0, 0], ['O', 0, 1.21, 0],
        ['C', 1.28, -0.76, 0], ['H', 2.13, -0.08, 0], ['H', 1.32, -1.4, 0.89], ['H', 1.32, -1.4, -0.89],
        ['C', -1.28, -0.76, 0], ['H', -2.13, -0.08, 0], ['H', -1.32, -1.4, 0.89], ['H', -1.32, -1.4, -0.89]],
      ETOH: [['C', 0, 0, 0], ['C', 1.52, 0, 0], ['O', 2.0, 1.33, 0], ['H', 2.95, 1.3, 0],
        ['H', -0.37, 1.03, 0], ['H', -0.37, -0.51, 0.89], ['H', -0.37, -0.51, -0.89],
        ['H', 1.89, -0.51, 0.89], ['H', 1.89, -0.51, -0.89]],
      MEOH: [['C', 0, 0, 0], ['O', 1.43, 0, 0], ['H', 1.75, 0.9, 0],
        ['H', -0.37, 1.03, 0], ['H', -0.37, -0.51, 0.89], ['H', -0.37, -0.51, -0.89]]
    };
  })();
  function fromXYZ(list) {
    const g = new THREE.Group();
    let cx = 0, cy = 0, cz = 0;
    for (const a of list) { cx += a[1]; cy += a[2]; cz += a[3]; }
    cx /= list.length; cy /= list.length; cz /= list.length;
    const k = 0.156;
    for (const a of list) g.add(atom(a[0], (a[1] - cx) * k, (a[2] - cy) * k, (a[3] - cz) * k));
    return g;
  }

  const BUILDERS = {
    CH4(own) {
      const g = new THREE.Group();
      const c = atom('C', 0, 0, 0, own);
      g.add(c);
      g.userData.core = c;
      g.userData.arms = TET.map(d => {
        const h = atom('H', d.x * 0.17, d.y * 0.17, d.z * 0.17);
        g.add(h);
        return { mesh: h, dir: d.clone(), len: 0.17 };
      });
      return g;
    },
    N2() {
      const g = new THREE.Group();
      g.add(atom('N', -0.075, 0, 0), atom('N', 0.075, 0, 0));
      return g;
    },
    O2() {
      const g = new THREE.Group();
      g.add(atom('O', -0.075, 0, 0), atom('O', 0.075, 0, 0));
      return g;
    },
    CO() {
      const g = new THREE.Group();
      g.add(atom('C', -0.07, 0, 0), atom('O', 0.08, 0, 0));
      return g;
    },
    CO2() {
      const g = new THREE.Group();
      g.add(atom('C', 0, 0, 0), atom('O', -0.16, 0, 0), atom('O', 0.16, 0, 0));
      return g;
    },
    H2O() {
      const g = new THREE.Group();
      const a = 104.5 / 2 * Math.PI / 180;
      g.add(atom('O', 0, 0, 0),
        atom('H', Math.sin(a) * 0.13, Math.cos(a) * 0.13, 0),
        atom('H', -Math.sin(a) * 0.13, Math.cos(a) * 0.13, 0));
      return g;
    },
    H2() {
      const g = new THREE.Group();
      g.add(atom('H', -0.05, 0, 0), atom('H', 0.05, 0, 0));
      return g;
    },
    H2S() {
      const g = new THREE.Group();
      const a = 92 / 2 * Math.PI / 180;
      g.add(atom('S', 0, 0, 0),
        atom('H', Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0),
        atom('H', -Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0));
      return g;
    },
    // Пары силикона — гексаметилдисилоксан (CH3)3Si–O–Si(CH3)3, упрощённо:
    // два атома Si, мостиковый O и по три метильные группы (показаны атомами C)
    SIL() {
      const g = new THREE.Group();
      g.add(atom('Si', -0.15, 0, 0), atom('Si', 0.15, 0, 0), atom('O', 0, 0.06, 0));
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const a = k / 3 * Math.PI * 2;
          g.add(atom('C', sx * 0.27, Math.cos(a) * 0.12, Math.sin(a) * 0.12));
        }
      }
      return g;
    },
    // Гидроксид-ион OH⁻ (знак заряда добавляет страница)
    OH() {
      const g = new THREE.Group();
      g.add(atom('O', 0, 0, 0), atom('H', 0.15, 0, 0));
      return g;
    },
    // Летучие органические вещества — по приближённым координатам атомов (Å)
    IBUT: () => fromXYZ(XYZ.IBUT),
    TOL: () => fromXYZ(XYZ.TOL),
    ACET: () => fromXYZ(XYZ.ACET),
    ETOH: () => fromXYZ(XYZ.ETOH),
    MEOH: () => fromXYZ(XYZ.MEOH),
    // Обобщённая «молекула воздуха»: однотипная, почти прозрачная,
    // чтобы не отвлекать от обнаруживаемого газа
    AIR() {
      const g = new THREE.Group();
      for (const x of [-0.07, 0.07]) {
        const m = new THREE.Mesh(_atomGeo, airMat());
        m.scale.setScalar(0.1);
        m.position.x = x;
        m.renderOrder = 1;
        g.add(m);
      }
      return g;
    }
  };
  let _airMat = null;
  function airMat() {
    if (!_airMat) _airMat = new THREE.MeshStandardMaterial({
      color: 0xcfd8e6, roughness: 0.6, metalness: 0, envMapIntensity: 0.2,
      transparent: true, opacity: 0.055, depthWrite: false
    });
    return _airMat;
  }

  GA.makeMolecule = function (type, ownMaterial = false) {
    const g = BUILDERS[type](ownMaterial);
    g.userData.type = type;
    g.scale.setScalar(GA.molScale);
    return g;
  };

  // Заряд молекулы: true или '+' — положительный ион (красноватый оттенок),
  // '-' — отрицательный ион (голубоватый), false — нейтральная молекула
  GA.setCharge = function (obj, charge) {
    const v = charge === '-' ? 'anion' : (charge ? 'cation' : undefined);
    obj.traverse(o => {
      if (!o.isMesh || !o.userData.el || o.userData.own) return;
      o.material = atomMat(o.userData.el, v);
    });
  };

  // Цвета для легенды (CSS)
  GA.legendDot = function (el) {
    return '#' + sat(ATOM[el].color).getHexString();
  };

  /* ------------------------------------------------------------------
     Газовое поле: молекулы диффундируют из «окружающей среды» внутрь
     сенсора. Геометрию сенсора страница задаёт функцией confine().
     ------------------------------------------------------------------
     opts:
       scene, count, box: {xMin,xMax,yMin,yMax,zMin,zMax} — внешняя область,
       pickType(): string — тип молекулы при «подпитке» на левой границе,
       confine(p, v, m): bool — обрабатывает столкновения со стенками,
                         вернуть false, если молекула должна быть заменена,
       speed, ownMaterial: {CH4:true}
  */
  GA.GasField = function (opts) {
    this.scene = opts.scene;
    this.box = opts.box;
    this.pickType = opts.pickType;
    this.confine = opts.confine;
    this.speed = opts.speed || 1.4;
    this.collide = opts.collide || 2.2;   // частота «столкновений», 1/с (меньше — быстрее диффузия)
    this.ownMaterial = opts.ownMaterial || {};
    this.list = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);
    for (let i = 0; i < opts.count; i++) this.spawn(null, true);
  };
  GA.GasField.prototype = {
    randomOutside() {
      const b = this.box;
      return new THREE.Vector3(
        THREE.MathUtils.lerp(b.xMin, b.xMax, Math.random()),
        THREE.MathUtils.lerp(b.yMin, b.yMax, Math.random()),
        THREE.MathUtils.lerp(b.zMin, b.zMax, Math.random()));
    },
    spawn(type, anywhere, pos) {
      type = type || this.pickType();
      const obj = GA.makeMolecule(type, !!this.ownMaterial[type]);
      const p = pos ? pos.clone() : this.randomOutside();
      if (!anywhere && !pos) p.x = this.box.xMin + Math.random() * 0.3;
      obj.position.copy(p);
      obj.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      const m = {
        obj, type,
        vel: new THREE.Vector3().randomDirection().multiplyScalar(this.speed * (0.6 + Math.random() * 0.8)),
        spin: new THREE.Vector3().randomDirection().multiplyScalar(1.5 + Math.random() * 2),
        state: {}, inside: false, dead: false
      };
      this.group.add(obj);
      this.list.push(m);
      return m;
    },
    remove(m) {
      m.dead = true;
      this.group.remove(m.obj);
      m.obj.traverse(o => { if (o.material && o.userData.own) o.material.dispose(); });
    },
    replace(m, type, anywhere) {
      this.remove(m);
      return this.spawn(type, anywhere);
    },
    step(dt) {
      if (dt <= 0) return;
      const b = this.box;
      for (let i = 0; i < this.list.length; i++) {
        const m = this.list[i];
        if (m.dead || m.frozen) continue;     // frozen — молекула адсорбирована на поверхности
        // броуновское движение: случайные «столкновения»
        if (Math.random() < dt * this.collide) {
          const s = m.vel.length();
          m.vel.randomDirection().multiplyScalar(THREE.MathUtils.lerp(s, this.speed * (0.6 + Math.random() * 0.8), 0.3));
        }
        m.obj.position.addScaledVector(m.vel, dt);
        m.obj.rotation.x += m.spin.x * dt;
        m.obj.rotation.y += m.spin.y * dt;
        m.obj.rotation.z += m.spin.z * dt;
        const p = m.obj.position;
        const keep = this.confine(p, m.vel, m);
        if (keep === false) { this.replace(m, null, false); continue; }
        if (!m.inside) {
          // внешняя граница слева — «резервуар»: молекула отражается
          // зеркально и при этом получает состав окружающей среды.
          // (Перезапуск со случайным направлением давал бы скопление у стенки.)
          if (p.x < b.xMin) {
            p.x = b.xMin; m.vel.x = Math.abs(m.vel.x);
            const t = this.pickType();
            if (t !== m.type) {
              const nm = this.spawn(t, true, p);
              nm.vel.copy(m.vel);
              this.remove(m);
            }
            continue;
          }
          if (p.y < b.yMin) { p.y = b.yMin; m.vel.y = Math.abs(m.vel.y); }
          if (p.y > b.yMax) { p.y = b.yMax; m.vel.y = -Math.abs(m.vel.y); }
          if (p.z < b.zMin) { p.z = b.zMin; m.vel.z = Math.abs(m.vel.z); }
          if (p.z > b.zMax) { p.z = b.zMax; m.vel.z = -Math.abs(m.vel.z); }
        }
      }
      if (this.list.length > 600 || this.list.some(m => m.dead)) this.list = this.list.filter(m => !m.dead);
    },
    countInside(type) {
      let n = 0;
      for (const m of this.list) if (m.inside && (!type || m.type === type)) n++;
      return n;
    }
  };

  /* ------------------------------------------------------------------
     Подписи элементов, привязанные к 3D-точкам
     ------------------------------------------------------------------ */
  GA.Labels = function () {
    this.root = document.getElementById('labels');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'lbl-lines');
    this.root.appendChild(this.svg);
    this.items = [];
    this.visible = true;
    this.avoid = null;            // THREE.Box3 — область объекта, которую подписи не перекрывают
    this.margin = 22;             // отступ подписи от контура объекта, px
    this._v = new THREE.Vector3();
  };
  GA.Labels.prototype = {
    // anchor — Object3D или Vector3 (точка на объекте, куда ведёт выноска)
    // opts.side: 'top' | 'bottom' | 'auto'; opts.near — см. update()
    add(text, anchor, opts = {}) {
      const el = document.createElement('div');
      el.className = 'lbl' + (opts.pop ? ' pop' : '');
      el.innerHTML = text;
      this.root.appendChild(el);
      const NS = 'http://www.w3.org/2000/svg';
      const line = document.createElementNS(NS, 'line');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.5');
      if (opts.pop) { line.setAttribute('class', 'pop'); dot.setAttribute('class', 'pop'); }
      this.svg.appendChild(line);
      this.svg.appendChild(dot);
      const it = { el, line, dot, anchor, side: opts.side || 'auto', near: !!opts.near, ttl: null, pop: !!opts.pop, w: 0, h: 0 };
      this.items.push(it);
      return it;
    },
    // Короткоживущая подпись (например «поглощение 3,4 мкм»)
    pop(text, anchor, ttl = 1.6, opts = {}) {
      const it = this.add(text, anchor, Object.assign({ pop: true }, opts));
      it.ttl = ttl;
      it.t0 = performance.now();
      return it;
    },
    setAvoid(box3) { this.avoid = box3; },
    // Дополнительные препятствия (например, логотип): подписи их обходят сбоку
    addObstacle(o) { (this.obstacles = this.obstacles || []).push(o); },   // Box3 или () => {l,r,t,b} в px
    _projRect(b, camera, W, H) {
      const v = this._v, r = { l: 1e9, r: -1e9, t: 1e9, b: -1e9 };
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera);
        const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
        r.l = Math.min(r.l, sx); r.r = Math.max(r.r, sx);
        r.t = Math.min(r.t, sy); r.b = Math.max(r.b, sy);
      }
      return r;
    },
    setVisible(v) { this.visible = v; },
    _remove(i) {
      const it = this.items[i];
      it.el.remove(); it.line.remove(); it.dot.remove();
      this.items.splice(i, 1);
    },
    update(camera) {
      const W = window.innerWidth, H = window.innerHeight;
      const now = performance.now();
      const v = this._v;

      // экранный прямоугольник объекта
      let rect = null;
      if (this.avoid) {
        const b = this.avoid;
        rect = { l: 1e9, r: -1e9, t: 1e9, b: -1e9 };
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera);
          const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
          rect.l = Math.min(rect.l, sx); rect.r = Math.max(rect.r, sx);
          rect.t = Math.min(rect.t, sy); rect.b = Math.max(rect.b, sy);
        }
      }

      // крупный план: объект не помещается в экран — подписи ставим у точек привязки
      const big = rect && (rect.t < 0 || rect.b > H || rect.l < 0 || rect.r > W);

      // Препятствия: логотип и т.п., панели интерфейса, сам объект
      const obst = (this.obstacles || []).map(b => typeof b === 'function' ? b() : this._projRect(b, camera, W, H)).filter(Boolean);
      for (const sel of ['.title', '#mols', '#info', '#controls', '#readout']) {
        const e = document.querySelector(sel);
        if (e && e.getClientRects().length) {           // (у position:fixed offsetParent всегда null)
          const r = e.getBoundingClientRect();
          obst.push({ l: r.left, r: r.right, t: r.top, b: r.bottom });
        }
      }
      const blockers = obst.slice();
      if (rect && !big) blockers.push(rect);
      const hit = (x, y, w, h, r, pad = 6) => x < r.r + pad && x + w > r.l - pad && y < r.b + pad && y + h > r.t - pad;

      const vis = [];
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        if (it.ttl !== null) {
          const age = (now - it.t0) / 1000;
          if (age > it.ttl) { this._remove(i); continue; }
          const op = String(Math.min(1, (it.ttl - age) / 0.4));
          it.el.style.opacity = op; it.line.style.opacity = op; it.dot.style.opacity = op;
        }
        const a = it.anchor;
        if (a.isObject3D) a.getWorldPosition(v); else v.copy(a);
        v.project(camera);
        // камера внутри объекта — постоянные подписи некуда вынести, скрываем их
        const camInside = this.avoid && this.avoid.containsPoint(camera.position);
        const hidden = (!this.visible && !it.pop) || (camInside && !it.pop) || v.z > 1 || (a.isObject3D && !a.parent);
        it.hidden = hidden;
        it.el.style.display = hidden ? 'none' : '';
        it.line.style.display = it.dot.style.display = hidden ? 'none' : '';
        if (hidden) continue;
        it.ax = (v.x + 1) / 2 * W;
        it.ay = (1 - v.y) / 2 * H;
        if (!it.w) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
        vis.push(it);
      }

      // Размещение: для каждой подписи перебираются положения рядом с «идеальным»
      // (над/под объектом напротив точки привязки) и выбирается ближайшее, не
      // пересекающее объект, логотип, панели и уже размещённые подписи.
      vis.sort((p, q) => (p.pop - q.pop) || (this.items.indexOf(p) - this.items.indexOf(q)));
      const placedRects = [];
      for (const it of vis) {
        let side = it.side;
        if (!rect || big) side = 'free';
        else if (side === 'auto') side = it.ay < (rect.t + rect.b) / 2 ? 'top' : 'bottom';
        const x0 = it.ax - it.w / 2;
        const y0 = side === 'free' ? it.ay - it.h - 24 : (side === 'top' ? rect.t - this.margin - it.h : rect.b + this.margin);
        const dir = side === 'bottom' ? 1 : -1;
        const ys = [y0, y0 + dir * (it.h + 6), y0 + 2 * dir * (it.h + 6), y0 + 3 * dir * (it.h + 6)];
        for (let k = 1; k <= 6; k++) ys.push(y0 - dir * k * (it.h + 6));   // на край объекта (запасной вариант)
        for (const o of obst) ys.push(o.b + 6, o.t - it.h - 6);
        if (side === 'free') ys.push(it.ay + 24);
        const xs = [x0];
        for (let d = 25; d <= 700; d += 25) xs.push(x0 - d, x0 + d);
        for (const o of blockers) xs.push(o.l - it.w - 10, o.r + 10);

        const search = (blk) => {
          let best = null, bestCost = 1e9;
          for (const y of ys) {
            if (y < 6 || y + it.h > H - 6) continue;
            const cy = Math.abs(y - y0) * 1.6;
            if (cy >= bestCost) continue;
            for (const x of xs) {
              if (x < 6 || x + it.w > W - 6) continue;
              const cost = cy + Math.abs(x - x0);
              if (cost >= bestCost) continue;
              if (blk.some(o => hit(x, y, it.w, it.h, o))) continue;
              if (placedRects.some(o => hit(x, y, it.w, it.h, o, 4))) continue;
              best = { x, y }; bestCost = cost;
            }
          }
          return best;
        };
        // если вокруг объекта места нет (маленькое окно) — разрешаем лечь на край
        // объекта, но не под панели интерфейса и не на логотип
        let best = search(blockers) || search(obst);
        // opts.near: если свободное место только далеко в стороне от точки привязки (> 200 px),
        // подпись может лечь у края габарита объекта ближе к точке (габаритный прямоугольник
        // проекции заметно больше силуэта, и там обычно пусто)
        if (it.near && best && Math.abs(best.x - x0) > 200) {
          const alt = search(obst);
          if (alt && Math.abs(alt.x - x0) + Math.abs(alt.y - y0) * 1.6 < Math.abs(best.x - x0) + Math.abs(best.y - y0) * 1.6) best = alt;
        }
        if (!best) best = { x: Math.max(6, Math.min(W - it.w - 6, x0)), y: Math.max(6, Math.min(H - it.h - 6, y0)) };
        it.x = best.x; it.y = best.y;
        placedRects.push({ l: it.x, r: it.x + it.w, t: it.y, b: it.y + it.h });
      }
      for (const it of this.items) {
        if (it.hidden || it.ax === undefined) continue;
        it.el.style.left = it.x.toFixed(1) + 'px';
        it.el.style.top = it.y.toFixed(1) + 'px';
        const lx = Math.max(it.x + 6, Math.min(it.x + it.w - 6, it.ax));
        const ly = it.y + it.h / 2 < it.ay ? it.y + it.h : it.y;
        it.line.setAttribute('x1', lx.toFixed(1)); it.line.setAttribute('y1', ly.toFixed(1));
        it.line.setAttribute('x2', it.ax.toFixed(1)); it.line.setAttribute('y2', it.ay.toFixed(1));
        it.dot.setAttribute('cx', it.ax.toFixed(1)); it.dot.setAttribute('cy', it.ay.toFixed(1));
      }
    }
  };

  /* ------------------------------------------------------------------
     Самописец: несколько кривых сигнала во времени
     ------------------------------------------------------------------ */
  GA.StripChart = function (canvas, series, opts = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.series = series; // [{name,color,data:[]}]
    this.max = opts.max || 100;
    this.min = opts.min || 0;
    this.len = opts.len || 240;
    this.gridLines = opts.gridLines || [];
    this.acc = 0;
    this.period = opts.period || 0.05;
  };
  GA.StripChart.prototype = {
    push(values, dtReal) {
      this.acc += dtReal;
      if (this.acc < this.period) return;
      this.acc = 0;
      values.forEach((v, i) => {
        const d = this.series[i].data;
        d.push(v);
        if (d.length > this.len) d.shift();
      });
      this.draw();
    },
    draw() {
      const c = this.c, g = this.g;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const y = v => H - 4 - (v - this.min) / (this.max - this.min) * (H - 8);
      g.strokeStyle = 'rgba(255,255,255,.08)';
      g.lineWidth = 1;
      g.font = '10px Segoe UI, sans-serif';
      g.fillStyle = 'rgba(255,255,255,.35)';
      for (const gl of this.gridLines) {
        g.beginPath(); g.moveTo(0, y(gl.v) + .5); g.lineTo(W, y(gl.v) + .5); g.stroke();
        if (gl.t) g.fillText(gl.t, 3, y(gl.v) - 2);
      }
      for (const s of this.series) {
        g.strokeStyle = s.color;
        g.lineWidth = 1.8;
        g.beginPath();
        s.data.forEach((v, i) => {
          const x = W - (s.data.length - 1 - i) * (W / (this.len - 1));
          i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v));
        });
        g.stroke();
      }
    }
  };

  /* ------------------------------------------------------------------
     Объёмный логотип (требует assets/logo.js → window.GA_LOGO)
     Рисуется отдельным 3D-слоем поверх сцены со своей неподвижной камерой:
     всегда обращён лицом к зрителю и не зависит от вида/вращения камеры сцены.
     Положение пересчитывается под размер окна: как можно выше, в свободной
     полосе между заголовком (.title) и правой панелью (#info).
     Объём — стопка слоёв с одной альфа-картинкой: лицо в цвете, грани темнее.
     opts: maxPx (наибольшая ширина, px), top (отступ сверху, px),
           depth (толщина в долях ширины), layers, spinEvery, spinTime (с)
     ------------------------------------------------------------------ */
  GA.addLogo = function (stage, opts = {}) {
    if (!window.GA_LOGO) return null;
    const L = window.GA_LOGO;
    const aspect = L.h / L.w;
    const depth = opts.depth || 0.02;
    const layers = opts.layers || 48;
    const maxPx = opts.maxPx || 560;
    const topPx = opts.top !== undefined ? opts.top : 14;

    const tex = new THREE.TextureLoader().load(L.src);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
    // лицевая сторона — яркая, глянцевая, под прозрачным лаком (clearcoat)
    const face = new THREE.MeshPhysicalMaterial({
      map: tex, alphaTest: 0.5, side: THREE.DoubleSide,
      metalness: 0.05, roughness: 0.35, envMapIntensity: 0.7,
      clearcoat: 1, clearcoatRoughness: 0.02,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3,
      toneMapped: false             // без тон-маппинга яркий красный не выцветает в розовый
    });
    const side = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x6a6a6a, metalness: 0.4, roughness: 0.45
    });
    const back = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x9a9a9a, metalness: 0.3, roughness: 0.4
    });

    // логотип единичной ширины; размер на экране задаётся масштабом группы
    const geo = new THREE.PlaneGeometry(1, aspect);
    const group = new THREE.Group();
    for (let i = 0; i < layers; i++) {
      const k = i / (layers - 1);
      const m = new THREE.Mesh(geo, i === 0 ? face : (i === layers - 1 ? back : side));
      m.position.z = depth / 2 - k * depth;          // ось вращения — по центру толщины
      group.add(m);
    }
    // световая полоса, пробегающая по лицевой стороне (по форме логотипа)
    const sweepMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, t: { value: -1 }, k: { value: 0 }, asp: { value: aspect },
        g1: { value: new THREE.Vector2(0.3, 0.6) }, g2: { value: new THREE.Vector2(0.7, 0.4) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform sampler2D map; uniform float t; uniform float k; uniform float asp; uniform vec2 g1; uniform vec2 g2; varying vec2 vUv;' +
        'void main(){ float a = step(0.5, texture2D(map, vUv).a);' +
        ' float x = vUv.x + (vUv.y - 0.5) * 0.45;' +
        ' float b = exp(-pow((x - t) / 0.045, 2.0)) + 0.35 * exp(-pow((x - t + 0.09) / 0.02, 2.0));' +
        ' vec2 d1 = (vUv - g1) * vec2(1.0, asp); vec2 d2 = (vUv - g2) * vec2(1.0, asp);' +
        ' float g = 1.1 * exp(-dot(d1, d1) / 0.0016) + 0.85 * exp(-dot(d2, d2) / 0.001) + 0.25 * exp(-dot(d1, d1) / 0.008) + 0.2 * exp(-dot(d2, d2) / 0.006);' +
        ' float v = (b * k + g) * a; gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * v, v); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const sweep = new THREE.Mesh(geo, sweepMat);
    sweep.position.z = depth / 2 + 0.0008;
    sweep.renderOrder = 2;
    group.add(sweep);

    // собственная сцена и камера слоя
    const hud = new THREE.Scene();
    // своё окружение для отражений логотипа: тёмная «студия» с яркими софтбоксами —
    // цвет остаётся насыщенным, а блики чёткие
    {
      const pm = new THREE.PMREMGenerator(stage.renderer);
      const studio = new THREE.Scene();
      studio.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0x07090d, side: THREE.BackSide })));
      for (const [x, y, z, w, h] of [[-8, 7, 3, 6, 2.2], [9, 2, 2.5, 2.2, 7], [0, -9, 2, 9, 1.2]]) {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
        b.position.set(x, y, z); b.lookAt(0, 0, 0);
        studio.add(b);
      }
      hud.environment = pm.fromScene(studio, 0.02).texture;
    }
    hud.add(new THREE.HemisphereLight(0xdfeaff, 0x1a1f2a, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-3, 4, 6);
    hud.add(key);
    hud.add(group);
    const D = 10, FOV = 20;
    const cam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
    cam.position.set(0, 0, D);
    stage.overlays.push({ scene: hud, camera: cam });

    // экранный прямоугольник логотипа (в покое), px
    const rect = { l: 0, r: 0, t: 0, b: 0 };
    function layout() {
      const W = window.innerWidth, H = window.innerHeight;
      cam.aspect = W / H;
      cam.updateProjectionMatrix();
      // логотип — вверху по центру свободной области между левой колонкой и описанием
      GA.layoutUI(stage, (xL, xR) => {
        const wPx = Math.max(120, Math.min(maxPx, xR - xL, 0.125 * H / aspect));   // не выше 12,5 % высоты окна
        const hPx = wPx * aspect;
        const cx = (xL + xR) / 2, cy = topPx + hPx / 2;
        const k = 2 * D * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / H;   // world-единиц на пиксель в плоскости z = 0
        group.scale.setScalar(wPx * k);
        group.position.set((cx - W / 2) * k, (H / 2 - cy) * k, 0);
        rect.l = cx - wPx / 2; rect.r = cx + wPx / 2; rect.t = topPx; rect.b = topPx + hPx;
        return rect.b;
      });
    }
    layout();
    window.addEventListener('resize', layout);
    if (GA.labels && GA.labels.addObstacle) GA.labels.addObstacle(() => rect);

    // Логотип неподвижен; раз в spinEvery секунд — один оборот вокруг
    // вертикальной оси через центр надписи (плавный разгон и торможение).
    // &logot=N — сдвиг фазы анимации логотипа (для проверки бликов на снимках)
    const lt = /[#&]logot=([0-9.]+)/.exec(location.hash);
    let tt = lt ? +lt[1] : 0, frame = 0;
    stage.onFrame((dt, t, dtReal) => {
      if (++frame % 30 === 0) layout();               // панели могли изменить размер
      tt += dtReal;                                   // не зависит от паузы и скорости анимации
      // блики скользят по глянцевой поверхности по плавным траекториям
      sweepMat.uniforms.g1.value.set(0.5 + 0.45 * Math.sin(tt * 0.43), 0.5 + 0.42 * Math.cos(tt * 0.61));
      sweepMat.uniforms.g2.value.set(0.5 - 0.42 * Math.sin(tt * 0.29 + 1.3), 0.5 + 0.4 * Math.sin(tt * 0.53 + 0.4));
      // световая полоса — раз в 7 с, вне оборота логотипа
      const sp = tt % 7;
      sweepMat.uniforms.t.value = -0.2 + (sp / 1.3) * 1.5;
      sweepMat.uniforms.k.value = sp < 1.3 ? Math.sin(Math.PI * sp / 1.3) * 0.9 : 0;
      if (!opts.spinEvery) return;
      const every = opts.spinEvery, dur = opts.spinTime || 2.5;
      const ph = tt % every, start = every - dur;
      if (ph < start) { group.rotation.y = 0; return; }
      const q = (ph - start) / dur;
      const e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
      group.rotation.y = e * Math.PI * 2;
    });
    return group;
  };

  /* ------------------------------------------------------------------
     Компоновка страницы (одинаковая для всех анимаций):
       вверху по центру — логотип, под ним название датчика;
       слева под названием — «Управление», под ним «Показание»;
       внизу во всю ширину до колонки описания — «Обозначения»;
       справа — описание. 3D-сцена центрируется в свободной области.
     placeLogo(xL, xR) размещает логотип и возвращает его нижний край, px.
     ------------------------------------------------------------------ */
  GA.layoutUI = function (stage, placeLogo) {
    const W = window.innerWidth, H = window.innerHeight;
    const title = document.querySelector('.title');
    // стартовая страница: шапка по центру во всю ширину, внизу ряд карточек (#cards)
    const cards = document.getElementById('cards');
    if (cards && !document.getElementById('controls')) {
      const hx = W / 2, half = W / 2 - 16;
      const logoB = placeLogo ? placeLogo(hx - half, hx + half) : 8;
      let titleB = logoB;
      if (title) {
        title.style.left = Math.max(16, hx - title.offsetWidth / 2) + 'px';
        title.style.top = (logoB + 2) + 'px';
        titleB = title.getBoundingClientRect().bottom;
      }
      const cTop = cards.getBoundingClientRect().top;
      GA.homeArea = { top: titleB, bottom: cTop };
      stage.camera.setViewOffset(W, H, 0, H / 2 - (titleB + cTop) / 2, W, H);
      return;
    }
    if (!GA._ui) {
      GA._ui = {};
      const a = title && title.querySelector('a');
      const col = document.createElement('div');
      col.id = 'leftcol';
      if (a) { a.id = 'home'; a.className = 'home-btn'; a.textContent = 'НА СТАРТОВУЮ СТРАНИЦУ'; col.appendChild(a); }
      for (const id of ['controls', 'readout']) { const e = document.getElementById(id); if (e) col.appendChild(e); }
      document.body.appendChild(col);
      GA._ui.col = col;
      // «Принцип работы»: заголовок закреплён, текст прокручивается; стрелки сверху и снизу,
      // стрелка неактивна, если в её сторону прокручивать нечего
      const inf = document.getElementById('info');
      if (inf) {
        const h = inf.querySelector('h3');
        const body = document.createElement('div'); body.className = 'info-body';
        for (const n of [...inf.childNodes]) if (n !== h) body.appendChild(n);
        const mk = (cls, sym, dir, ttl) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'scr ' + cls;
          b.textContent = sym; b.title = ttl;
          b.addEventListener('click', () => body.scrollBy({ top: dir * Math.max(40, body.clientHeight * 0.8), behavior: 'smooth' }));
          return b;
        };
        const up = mk('up', '▲', -1, 'Прокрутить вверх'), dn = mk('dn', '▼', 1, 'Прокрутить вниз');
        inf.append(up, body, dn);
        if (h) inf.insertBefore(h, up);
        const upd = () => {
          up.disabled = body.scrollTop <= 1;
          dn.disabled = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
        };
        body.addEventListener('scroll', upd, { passive: true });
        GA._ui.infoUpd = upd;
      }
      // кнопки видов: подсвечена кнопка текущего вида; после ручного поворота/приближения
      // камеры мышью вид уже не совпадает ни с одним — подсветка снимается
      const vbs = [...document.querySelectorAll('[data-view]')];
      if (vbs.length) {
        const setV = n => vbs.forEach(b => b.classList.toggle('on', +b.dataset.view === n));
        const hv = /view=(\d)/.exec(location.hash);
        setV(hv ? +hv[1] : 0);
        vbs.forEach(b => b.addEventListener('click', () => setV(+b.dataset.view)));
        if (stage.controls) stage.controls.addEventListener('start', () => setV(-1));
      }
    }
    const col = GA._ui.col;
    const info = document.getElementById('info');
    const infoL = info ? info.getBoundingClientRect().left : W;
    const mols = document.getElementById('mols');
    let legTop = H;
    if (mols) {
      mols.style.left = '16px';
      mols.style.right = Math.max(16, W - infoL + 12) + 'px';
      mols.style.bottom = '16px';
      legTop = mols.getBoundingClientRect().top;
    }
    const colR = 16 + col.offsetWidth;
    // шапка (логотип и название) — по центру над сценой, во всю доступную ширину окна
    const hx = THREE.MathUtils.clamp((colR + infoL) / 2, W * 0.3, W * 0.7);
    const half = Math.min(hx - 16, W - 16 - hx);
    const xL = hx - half, xR = hx + half;
    const logoB = placeLogo ? placeLogo(xL, xR) : 8;
    let titleB = logoB;
    if (title) {
      const tw = title.offsetWidth;
      title.style.left = Math.max(16, hx - tw / 2) + 'px';
      title.style.top = (logoB + 2) + 'px';
      titleB = title.getBoundingClientRect().bottom;
    }
    col.style.top = (titleB + 12) + 'px';
    col.style.bottom = (H - legTop + 10) + 'px';
    // описание — справа, под логотипом и названием
    if (info) { info.style.top = (titleB + 12) + 'px'; info.style.maxHeight = (H - titleB - 28) + 'px'; }
    if (GA._ui.infoUpd) GA._ui.infoUpd();
    // центр проекции — в середину свободной области между панелями
    const cx = (colR + infoL) / 2, cy = (titleB + legTop) / 2;
    stage.camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  };

  /* ------------------------------------------------------------------
     Мелкие помощники UI
     ------------------------------------------------------------------ */
  GA.bindRange = function (id, fmt, onChange) {
    const inp = document.getElementById(id);
    const out = document.querySelector('output[for="' + id + '"]');
    const upd = () => { const v = parseFloat(inp.value); if (out) out.textContent = fmt(v); onChange(v); };
    inp.addEventListener('input', upd);
    upd();
    return inp;
  };
  GA.bindToggle = function (id, initial, onChange) {
    const b = document.getElementById(id);
    let st = initial;
    const apply = () => { b.classList.toggle('on', st); onChange(st); };
    b.addEventListener('click', () => { st = !st; apply(); });
    apply();
    return { set(v) { st = v; apply(); }, get: () => st };
  };

  // Плавное приближение значения (экспоненциальное сглаживание)
  GA.approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

  // Анимация камеры к заданному виду
  GA.flyTo = function (stage, pos, target, dur = 1.2) {
    const p0 = stage.camera.position.clone(), t0 = stage.controls.target.clone();
    const start = performance.now();
    function tick() {
      const k = Math.min(1, (performance.now() - start) / (dur * 1000));
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      stage.camera.position.lerpVectors(p0, pos, e);
      stage.controls.target.lerpVectors(t0, target, e);
      if (k < 1) requestAnimationFrame(tick);
    }
    tick();
  };
})();
