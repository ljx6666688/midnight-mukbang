/* 深夜吃播 · 快递开箱 —— 第一人称 3D 小游戏（Three.js r149） */
(function () {
  "use strict";

  /* ==================== 调参区 ==================== */
  const TUNE = {
    boxBurnTime: 16,          // 纸箱从点燃到碳化熄灭的秒数
    furnBurnTime: 26,         // 家具上的火自行熄灭的秒数（家具不会坏）
    heatPerFirePerSec: 2,     // 每团火每秒贡献的热度
    maxHeatFires: 4,          // 计入热度的最大火焰数
    fansPerHeat: 0.55,        // 每秒热度换算成粉丝的比率（再乘吃相倍率）
    payoutPerFirePerSec: 1.2, // 每团火每秒的赔偿金
    fireDamagePerSec: 6,      // 贴着火每秒掉血
    hpRegenPerSec: 2.0,       // 呼吸回血：每秒恢复
    regenDelay: 2.0,          // 脱离火源多少秒后开始回血
    hurtRadius: 1.55,         // 掉血半径
    cookRadius: 2.0,          // 手持食材离火多近开始烤
    cookRate: 0.072,          // 每秒熟度（生→熟约 7 秒，完全炭化约 14 秒）
    spreadChancePerSec: 0.05, // 每秒蔓延基础概率
    spreadRadius: 2.6,        // 蔓延半径
    floorFireTime: 12,        // 地面火持续时间
    floorFireRadius: 1.05,    // 地面火的燃烧半径
    floorIgnitePerSec: 0.75,  // 箱子燃到四周/整体后每秒点燃地板的概率
    firefighterHeat: 160,     // 累计热度到多少消防员破门
    complaintHeat: 110,       // 邻居投诉阈值
    cutTime: 1.4,             // 切箱所需秒数
    fillTime: 1.1,            // 接水所需秒数
    waterRadius: 2.8,         // 泼水灭火半径
    moveSpeed: 4.0,
    runSpeed: 6.0,
    jumpSpeed: 5.4,           // 起跳初速度（约能跳 1.0 米高）
    gravity: 14,              // 重力加速度
    coyoteTime: 0.12,         // 离开地面后仍允许起跳的宽限时间（边缘起跳手感）
    playerRadius: 0.34,
    eyeHeight: 1.62,
    parcelInterval: 9,        // 快递间隔
    maxParcels: 6,
    baseFansPerDish: 55,
  };

  const ABILITIES = [
    { key: "leg", at: 250, name: "腿力增大 · F 踢开纸箱" },
    { key: "water2", at: 600, name: "水桶加倍 · 一桶水泼两道" },
    { key: "eat", at: 1200, name: "吃相升级 · 涨粉 ×1.5" },
    { key: "resist", at: 2000, name: "火灾抗性 · 灼烧减半" },
    { key: "speed", at: 3200, name: "移速提升 · 走得飞快" },
    { key: "nextHouse", at: 5000, name: "换房 · 本关完成" },
  ];

  const DANMAKU = [
    "这快递是粉丝寄的吧，稳",
    "大哥别烧啊，食材都焦了",
    "主播这火开得有点猛",
    "哈哈哈哈这波赔惨了",
    "烤好了吗？我等半天了",
    "纸箱当炭火，行家",
    "先接水吧，看得我心慌",
    "这厨房还能要吗",
    "下播吧主播，房子要没了",
    "刚来，怎么着火了",
    "吃播界的天花板（物理）",
    "白米饭配焦味，绝了",
  ];

  /* ==================== 基础工具 ==================== */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

  function canvasTexture(w, h, draw, repeatX, repeatY, linear) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeatX || repeatY) t.repeat.set(repeatX || 1, repeatY || 1);
    if (!linear) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  /* 简易伪随机（同一 seed 生成同一图案，避免每帧变化） */
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ==================== 贴图（全部程序生成，无外部素材） ==================== */

  /* 木地板：每块板单独色调 + 木纹 + 接缝阴影 */
  const texFloor = canvasTexture(512, 512, (g, w, h) => {
    const R = mulberry(20240517);
    const plankH = 64;
    for (let y = 0; y < h; y += plankH) {
      const t = 0.86 + R() * 0.28;
      const base = [110 * t, 78 * t, 54 * t];
      g.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
      g.fillRect(0, y, w, plankH);

      // 木纹
      for (let i = 0; i < 26; i++) {
        const gy = y + R() * plankH;
        g.strokeStyle = `rgba(${(base[0] * 0.62) | 0},${(base[1] * 0.6) | 0},${(base[2] * 0.55) | 0},${0.06 + R() * 0.14})`;
        g.lineWidth = 0.6 + R() * 1.6;
        g.beginPath();
        g.moveTo(0, gy);
        for (let x = 0; x <= w; x += 32) {
          g.lineTo(x, gy + Math.sin((x / w) * 6.28 + R() * 2) * (1.2 + R() * 1.6));
        }
        g.stroke();
      }
      // 木节
      if (R() < 0.5) {
        const kx = R() * w;
        const ky = y + plankH * (0.3 + R() * 0.4);
        const grd = g.createRadialGradient(kx, ky, 1, kx, ky, 7 + R() * 6);
        grd.addColorStop(0, "rgba(70,45,28,.55)");
        grd.addColorStop(1, "rgba(70,45,28,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(kx, ky, 9, 4, 0, 0, 6.284);
        g.fill();
      }
      // 板缝
      g.fillStyle = "rgba(20,12,6,.55)";
      g.fillRect(0, y + plankH - 2, w, 2);
      g.fillStyle = "rgba(255,230,190,.08)";
      g.fillRect(0, y, w, 1);
      // 板端接缝（错缝）
      const seamX = (R() * w) | 0;
      g.fillStyle = "rgba(20,12,6,.45)";
      g.fillRect(seamX, y, 2, plankH);
    }
    // 整体脏污/磨痕
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(0,0,0,${R() * 0.03})`;
      g.fillRect(R() * w, R() * h, 1 + R() * 3, 1);
    }
  }, 5, 5);

  const texFloorBump = canvasTexture(512, 512, (g, w, h) => {
    const R = mulberry(778899);
    g.fillStyle = "#808080";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) {
      g.fillStyle = "#585858";
      g.fillRect(0, y + 62, w, 2);
      for (let i = 0; i < 30; i++) {
        g.strokeStyle = `rgba(${R() < 0.5 ? 100 : 150},${R() < 0.5 ? 100 : 150},${R() < 0.5 ? 100 : 150},.5)`;
        g.lineWidth = 1 + R() * 2;
        const gy = y + R() * 64;
        g.beginPath();
        g.moveTo(0, gy);
        g.lineTo(w, gy + (R() - 0.5) * 6);
        g.stroke();
      }
    }
  }, 5, 5, true);

  /* 墙面：细腻乳胶漆颗粒 + 底部渐变 + 极淡的竖向刷痕 */
  const texWall = canvasTexture(512, 512, (g, w, h) => {
    const R = mulberry(31415);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#5d6a7d");
    grad.addColorStop(0.55, "#54607a");
    grad.addColorStop(1, "#475164");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const a = R() * 0.035;
      g.fillStyle = R() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2);
    }
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.004 + R() * 0.008})`;
      g.lineWidth = 2 + R() * 6;
      const x = R() * w;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + (R() - 0.5) * 12, h);
      g.stroke();
    }
  }, 2, 2);

  /* 瓦楞纸箱：瓦楞纹 + 牛皮纸斑点 + 边角磨损 */
  const texCardboard = canvasTexture(256, 256, (g, w, h) => {
    const R = mulberry(9001);
    g.fillStyle = "#b0763f";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 5) {
      g.fillStyle = `rgba(${90 + R() * 40},${60 + R() * 30},${30 + R() * 20},${0.02 + R() * 0.025})`;
      g.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? 60 : 255},${R() < 0.5 ? 40 : 240},${R() < 0.5 ? 20 : 200},${R() * 0.05})`;
      g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2);
    }
    // 边缘磨损（偏白）
    g.strokeStyle = "rgba(255,240,215,.35)";
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    g.strokeStyle = "rgba(120,80,40,.4)";
    g.lineWidth = 2;
    g.strokeRect(6, 6, w - 12, h - 12);
  });

  const texCardboardBump = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = "#888";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      g.fillStyle = "#6a6a6a";
      g.fillRect(0, y, w, 2);
    }
  }, 2, 2, true);

  /* 快递面单：随机条码 + 假文字行 */
  function makeLabelTexture(seed) {
    return canvasTexture(128, 160, (g, w, h) => {
      const R = mulberry(seed);
      g.fillStyle = "#f4f1e8";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(120,120,120,.6)";
      g.lineWidth = 2;
      g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = "#2a2a2a";
      g.fillRect(10, 12, w - 20, 10);
      // 文字行
      for (let i = 0; i < 5; i++) {
        const y = 34 + i * 12;
        g.fillStyle = `rgba(40,40,40,${0.5 + R() * 0.4})`;
        g.fillRect(12, y, (w - 24) * (0.35 + R() * 0.6), 4);
      }
      // 条码
      let x = 12;
      while (x < w - 14) {
        const bw = 1 + Math.floor(R() * 3);
        if (R() < 0.6) {
          g.fillStyle = "#1a1a1a";
          g.fillRect(x, h - 44, bw, 32);
        }
        x += bw + 1;
      }
      // 易碎标
      g.strokeStyle = "#c0392b";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(w - 26, h - 70);
      g.lineTo(w - 14, h - 70);
      g.lineTo(w - 20, h - 58);
      g.closePath();
      g.stroke();
    });
  }

  /* 胶带：半透明 + 反光条 */
  const texTape = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = "rgba(226,208,170,.78)";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,.22)";
    g.fillRect(0, 0, w, 8);
    g.fillStyle = "rgba(140,110,70,.18)";
    for (let i = 0; i < 30; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 1);
  });

  /* 布艺沙发：织纹 */
  const texFabric = canvasTexture(128, 128, (g, w, h) => {
    const R = mulberry(5150);
    g.fillStyle = "#42506e";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) {
      g.fillStyle = "rgba(255,255,255,.05)";
      g.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 3) {
      g.fillStyle = "rgba(0,0,0,.06)";
      g.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},255,${R() * 0.04})`;
      g.fillRect(R() * w, R() * h, 1, 1);
    }
  }, 3, 3);

  /* 拉丝金属 */
  const texMetal = canvasTexture(256, 256, (g, w, h) => {
    const R = mulberry(60606);
    g.fillStyle = "#b9c2cb";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const y = R() * h;
      g.strokeStyle = `rgba(${R() < 0.5 ? 255 : 120},${R() < 0.5 ? 255 : 130},${R() < 0.5 ? 255 : 145},${R() * 0.09})`;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + (R() - 0.5) * 2);
      g.stroke();
    }
  }, 1, 1);

  /* 接触阴影（画在地面上的一层软阴影，比实时阴影便宜且更"实"） */
  const texContactShadow = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grd.addColorStop(0, "rgba(0,0,0,.62)");
    grd.addColorStop(0.45, "rgba(0,0,0,.32)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  /* 烟 */
  const texSmoke = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grd.addColorStop(0, "rgba(180,180,180,.55)");
    grd.addColorStop(0.6, "rgba(140,140,140,.22)");
    grd.addColorStop(1, "rgba(120,120,120,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  const texFlame = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 92, 3, 64, 66, 62);
    grad.addColorStop(0, "rgba(255,255,240,1)");
    grad.addColorStop(0.22, "rgba(255,232,150,.98)");
    grad.addColorStop(0.5, "rgba(255,160,40,.85)");
    grad.addColorStop(0.78, "rgba(230,70,10,.42)");
    grad.addColorStop(1, "rgba(180,30,0,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(64, 2);
    g.bezierCurveTo(114, 46, 104, 118, 64, 126);
    g.bezierCurveTo(26, 118, 14, 46, 64, 2);
    g.fill();
    // 内焰
    const core = g.createRadialGradient(64, 96, 2, 64, 84, 34);
    core.addColorStop(0, "rgba(210,255,255,.55)");
    core.addColorStop(1, "rgba(160,220,255,0)");
    g.fillStyle = core;
    g.beginPath();
    g.moveTo(64, 52);
    g.bezierCurveTo(92, 84, 86, 116, 64, 120);
    g.bezierCurveTo(44, 116, 38, 84, 64, 52);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  /* ==================== 渲染器 / 场景 ==================== */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // 电影感色调映射
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  /* 画质档位（按 P 切换）：像素比与阴影是帧率的两大开销 */
  const QUALITY = [
    { name: "高", ratio: 2, shadows: true },
    { name: "中", ratio: 1.5, shadows: true },
    { name: "低", ratio: 1, shadows: false },
  ];
  let qualityIdx = 1;

  function applyQuality(idx, silent) {
    qualityIdx = (idx + QUALITY.length) % QUALITY.length;
    const q = QUALITY[qualityIdx];
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.ratio));
    renderer.setSize(innerWidth, innerHeight);
    if (renderer.shadowMap.enabled !== q.shadows) {
      renderer.shadowMap.enabled = q.shadows;
      scene.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.needsUpdate = true;
      });
    }
    if (!silent) showEvent("画质：" + q.name, 1000);
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161c26);
  scene.fog = new THREE.Fog(0x161c26, 16, 34);

  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(0, TUNE.eyeHeight, 4.2);

  /* ---------- 光照：冷色主光 + 暖色吊灯 + 粉色补光，营造"好看"的对比 ---------- */
  const ambientLight = new THREE.AmbientLight(0x8aa0c6, 0.28);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xa8bfe4, 0x46352a, 0.46);
  scene.add(hemiLight);

  // 窗户方向的冷色主光（带阴影）
  const keyLight = new THREE.DirectionalLight(0xbcd8ff, 1.05);
  keyLight.position.set(9, 7.5, -3);
  keyLight.castShadow = false;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -11;
  keyLight.shadow.camera.right = 11;
  keyLight.shadow.camera.top = 11;
  keyLight.shadow.camera.bottom = -11;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 30;
  keyLight.shadow.bias = -0.0012;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  // 吊灯：暖色，是房间的"氛围光"
  const lampLight = new THREE.PointLight(0xffc487, 1.7, 13, 2);
  lampLight.position.set(0, 3.05, 0);
  scene.add(lampLight);



  // 吊灯本体（给光照一个可见来源）：吊线 + 灯罩 + 灯泡
  const lampCord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6),
    new THREE.MeshStandardMaterial({ color: 0x1c222c, roughness: 0.8 })
  );
  lampCord.position.set(0, 3.5, 0);
  scene.add(lampCord);

  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.32, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x2f3a4a, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide })
  );
  lampShade.position.set(0, 3.2, 0);
  lampShade.rotation.x = Math.PI;
  lampShade.castShadow = true;
  scene.add(lampShade);
  const lampBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8 })
  );
  lampBulb.position.set(0, 3.08, 0);
  scene.add(lampBulb);
  // 灯泡外发光
  const lampGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 10),
    new THREE.MeshBasicMaterial({ map: texSmoke, color: 0xffd9a0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  lampGlow.position.set(0, 3.08, 0);
  scene.add(lampGlow);

  /* ==================== 房间 ==================== */
  const ROOM = { half: 5, wallH: 3.8 };
  const wallMeshes = [];
  const colliders = [];
  const burnables = [];
  const boxes = [];
  const foods = [];
  const fires = [];

  /* ==================== 物理世界（cannon.js） ==================== */
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 14;
  world.allowSleep = true;

  const matGround = new CANNON.Material("ground");
  const matBox = new CANNON.Material("box");
  world.defaultContactMaterial.friction = 0.5;
  world.defaultContactMaterial.restitution = 0.02;
  world.addContactMaterial(new CANNON.ContactMaterial(matGround, matBox, { friction: 0.55, restitution: 0.02 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matBox, matBox, { friction: 0.42, restitution: 0.04 }));

  // 地面
  const groundBody = new CANNON.Body({ mass: 0, material: matGround });
  groundBody.addShape(new CANNON.Box(new CANNON.Vec3(ROOM.half, 0.1, ROOM.half)));
  groundBody.position.set(0, -0.1, 0);
  world.addBody(groundBody);

  const floorMat = new THREE.MeshStandardMaterial({
    map: texFloor,
    bumpMap: texFloorBump,
    bumpScale: 0.035,
    roughness: 0.62,
    metalness: 0.04,
  });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM.half * 2, 0.2, ROOM.half * 2), floorMat);
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceil = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM.half * 2, 0.15, ROOM.half * 2),
    new THREE.MeshLambertMaterial({ color: 0x2a3342 })
  );
  ceil.position.y = ROOM.wallH;
  ceil.receiveShadow = true;
  scene.add(ceil);

  const wallMat = new THREE.MeshLambertMaterial({ map: texWall });
  const wallGeoX = new THREE.BoxGeometry(ROOM.half * 2 + 0.4, ROOM.wallH, 0.3);
  const wallGeoZ = new THREE.BoxGeometry(0.3, ROOM.wallH, ROOM.half * 2 + 0.4);

  function addWall(geo, x, z) {
    const m = new THREE.Mesh(geo, wallMat);
    m.position.set(x, ROOM.wallH / 2, z);
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
    const c = { x, z, hx: geo.parameters.width / 2, hz: geo.parameters.depth / 2, tag: "wall", top: ROOM.wallH };
    // 墙体也参与物理碰撞（箱子撞墙会被弹回）
    const body = new CANNON.Body({ mass: 0, material: matGround });
    body.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, ROOM.wallH / 2, c.hz)));
    body.position.set(x, ROOM.wallH / 2, z);
    world.addBody(body);
    c.body = body;
    wallMeshes.push({ mesh: m, home: m.position.clone(), collider: c, target: null });
    colliders.push(c);
  }
  addWall(wallGeoX, 0, -ROOM.half);
  addWall(wallGeoX, 0, ROOM.half);
  addWall(wallGeoZ, -ROOM.half, 0);
  addWall(wallGeoZ, ROOM.half, 0);

  // 墙上挂一幅抽象装饰画（无文字）
  const texArt = canvasTexture(256, 320, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1b2a45");
    grad.addColorStop(0.55, "#2f4a6d");
    grad.addColorStop(1, "#101827");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,224,150,.85)";
    g.beginPath();
    g.arc(w * 0.66, 92, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(10,14,22,.85)";
    g.beginPath();
    g.moveTo(0, h * 0.72);
    g.lineTo(w * 0.24, h * 0.52);
    g.lineTo(w * 0.44, h * 0.72);
    g.lineTo(w * 0.68, h * 0.46);
    g.lineTo(w, h * 0.74);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fill();
  });

  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.62),
    new THREE.MeshBasicMaterial({ map: texArt })
  );
  poster.position.set(-2.4, 1.9, -ROOM.half + 0.17);
  const mountedLater = [];
  scene.add(poster);

  const posterFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.42, 1.74, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x2b241c, roughness: 0.7 })
  );
  posterFrame.position.set(-2.4, 1.9, -ROOM.half + 0.13);
  scene.add(posterFrame);
  mountedLater.push(poster, posterFrame);

  /* ---------- 通用：圆角盒体 + 接触阴影 ---------- */
  // 用多条细长盒子拼出"倒角"的外观：把立方体按段数细分并在边缘收缩
  function roundedBox(w, h, d, r, seg) {
    r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    seg = Math.max(1, seg || 3);
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pos = g.attributes.position;
    const hw = w / 2 - r;
    const hh = h / 2 - r;
    const hd = d / 2 - r;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const cx = clamp(v.x, -hw, hw);
      const cy = clamp(v.y, -hh, hh);
      const cz = clamp(v.z, -hd, hd);
      const dx = v.x - cx;
      const dy = v.y - cy;
      const dz = v.z - cz;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6) {
        v.set(cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    return g;
  }

  // 地面接触阴影：贴在物体脚下的软阴影，比实时阴影更"实"，几乎零开销
  function addContactShadow(parent, w, d, opacity) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: texContactShadow,
        transparent: true,
        opacity: opacity === undefined ? 0.75 : opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w * 1.5, d * 1.5, 1);
    m.renderOrder = 1;
    parent.add(m);
    return m;
  }

  /* ---------- 踢脚线（细节，但一眼就能看出"做过"） ---------- */
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0x2c323d });
  const skirtMeshes = [];
  function addSkirting(w, d, x, z) {
    const m = new THREE.Mesh(roundedBox(w, 0.12, d, 0.02, 2), skirtMat);
    m.position.set(x, 0.06, z);
    m.castShadow = false;
    m.receiveShadow = true;
    scene.add(m);
    skirtMeshes.push(m);
    return m;
  }
  addSkirting(ROOM.half * 2, 0.06, 0, -ROOM.half + 0.16);
  addSkirting(ROOM.half * 2, 0.06, 0, ROOM.half - 0.16);
  addSkirting(0.06, ROOM.half * 2, -ROOM.half + 0.16, 0);
  addSkirting(0.06, ROOM.half * 2, ROOM.half - 0.16, 0);

  /* ---------- 窗户（主光从这边来，给它一个可见来源） ---------- */
  const windowGroup = new THREE.Group();
  const winFrameMat = new THREE.MeshStandardMaterial({ color: 0x39404d, roughness: 0.55, metalness: 0.25 });
  const glassMat = new THREE.MeshBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.55 });
  const winW = 2.6, winH = 1.6;
  const wf = [
    [winW, 0.1, 0.1, 0, winH / 2],
    [winW, 0.1, 0.1, 0, -winH / 2],
    [0.1, winH, 0.1, -winW / 2, 0],
    [0.1, winH, 0.1, winW / 2, 0],
    [0.07, winH, 0.07, 0, 0],
  ];
  for (const f of wf) {
    const m = new THREE.Mesh(roundedBox(f[0], f[1], f[2], 0.02, 2), winFrameMat);
    m.position.set(f[3], f[4], 0);
    windowGroup.add(m);
  }
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW - 0.16, winH - 0.16), glassMat);
  glass.position.z = -0.03;
  windowGroup.add(glass);
  windowGroup.position.set(ROOM.half - 0.2, 1.85, 1.9);
  windowGroup.rotation.y = -Math.PI / 2;
  scene.add(windowGroup);

  /* ---------- 家具材质 ---------- */
  const texWoodGrain = canvasTexture(256, 256, (g, w, h) => {
    const R = mulberry(4242);
    g.fillStyle = "#8a6141";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const y = R() * h;
      g.strokeStyle = `rgba(${60 + R() * 40},${38 + R() * 30},${22 + R() * 20},${0.08 + R() * 0.16})`;
      g.lineWidth = 0.8 + R() * 2.4;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 24) g.lineTo(x, y + Math.sin(x / 30 + R() * 3) * 3);
      g.stroke();
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(255,240,215,${R() * 0.05})`;
      g.fillRect(R() * w, R() * h, 2, 1);
    }
  }, 2, 2);

  const furnMatWood = new THREE.MeshStandardMaterial({ map: texWoodGrain, roughness: 0.52, metalness: 0.06 });
  const furnMatWoodDark = new THREE.MeshStandardMaterial({ color: 0x5a3f2c, roughness: 0.55, metalness: 0.05 });
  const furnMatSoft = new THREE.MeshStandardMaterial({ map: texFabric, roughness: 0.95, metalness: 0 });
  const furnMatMetal = new THREE.MeshStandardMaterial({ map: texMetal, color: 0xcfd6de, roughness: 0.32, metalness: 0.85 });

  function addFurniture(mesh, x, z, hx, hz, label, top) {
    mesh.position.set(x, mesh.position.y, z);
    scene.add(mesh);

    // 家具多是 Group，材质挂在子网格上：逐个克隆，避免不同家具共用同一材质
    const childMeshes = [];
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material && o.material.color) o.material = o.material.clone();
      childMeshes.push(o);
    });

    // top = 这件家具的顶面高度，跳到这个高度以上就能站上去
    const topVal = top === undefined ? 99 : top;
    const c = { x, z, hx, hz, tag: "furniture", top: topVal };
    colliders.push(c);

    // 家具的物理外形：从地面到顶面的一整块（箱子可以落在上面、堆在桌上）
    if (topVal < 50) {
      const body = new CANNON.Body({ mass: 0, material: matGround });
      body.addShape(new CANNON.Box(new CANNON.Vec3(hx, topVal / 2, hz)));
      body.position.set(x, topVal / 2, z);
      world.addBody(body);
      c.body = body;
    }
    const item = {
      kind: "furniture",
      label,
      mesh,
      childMeshes,
      collider: c,
      home: mesh.position.clone(),
      burn: null,
      isSink: false,
      baseColors: childMeshes.map((m) => (m.material && m.material.color ? m.material.color.clone() : null)),
    };
    burnables.push(item);
    return item;
  }

  const sofa = new THREE.Group();
  const sofaSeat = new THREE.Mesh(roundedBox(2.2, 0.46, 0.95, 0.14, 4), furnMatSoft);
  sofaSeat.position.y = 0.34;
  const sofaBack = new THREE.Mesh(roundedBox(2.2, 0.72, 0.3, 0.13, 4), furnMatSoft);
  sofaBack.position.set(0, 0.72, -0.34);
  const sofaArmL = new THREE.Mesh(roundedBox(0.26, 0.56, 0.95, 0.1, 3), furnMatSoft);
  sofaArmL.position.set(-1.05, 0.44, 0);
  const sofaArmR = sofaArmL.clone();
  sofaArmR.position.x = 1.05;
  const cushion1 = new THREE.Mesh(roundedBox(0.6, 0.16, 0.7, 0.07, 3), furnMatSoft);
  cushion1.position.set(-0.55, 0.63, 0.05);
  cushion1.rotation.y = 0.12;
  const cushion2 = new THREE.Mesh(roundedBox(0.55, 0.15, 0.66, 0.07, 3), furnMatSoft);
  cushion2.position.set(0.6, 0.62, -0.02);
  cushion2.rotation.y = -0.16;
  sofa.add(sofaSeat, sofaBack, sofaArmL, sofaArmR, cushion1, cushion2);
  addContactShadow(sofa, 2.3, 1.05, 0.72);
  addFurniture(sofa, -3.4, 4.3, 1.1, 0.5, "沙发", 0.62);

  const table = new THREE.Group();
  const tableTop = new THREE.Mesh(roundedBox(2.0, 0.12, 1.2, 0.05, 3), furnMatWood);
  tableTop.position.y = 0.8;
  const tableApron = new THREE.Mesh(roundedBox(1.86, 0.1, 1.06, 0.03, 2), furnMatWoodDark);
  tableApron.position.y = 0.71;
  for (const p of [[-0.9, -0.5], [0.9, -0.5], [-0.9, 0.5], [0.9, 0.5]]) {
    const leg = new THREE.Mesh(roundedBox(0.11, 0.78, 0.11, 0.02, 2), furnMatWoodDark);
    leg.position.set(p[0], 0.39, p[1]);
    table.add(leg);
  }
  table.add(tableTop, tableApron);
  addContactShadow(table, 2.1, 1.3, 0.7);
  addFurniture(table, 0, 0.4, 1.0, 0.6, "餐桌", 0.86);

  // 电视柜 + 电视（屏幕有画面感）
  const texScreen = canvasTexture(256, 160, (g, w, h) => {
    const R = mulberry(8080);
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, "#0a2d5c");
    grd.addColorStop(0.5, "#134a8c");
    grd.addColorStop(1, "#0d2f63");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // 直播画面：一个主播剪影 + 弹幕条
    g.fillStyle = "rgba(255,220,150,.85)";
    g.beginPath();
    g.arc(w * 0.5, h * 0.42, 22, 0, 6.284);
    g.fill();
    g.fillStyle = "rgba(255,200,120,.75)";
    g.fillRect(w * 0.5 - 34, h * 0.42 + 20, 68, 46);
    // 弹幕
    for (let i = 0; i < 7; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + R() * 0.5})`;
      g.fillRect(R() * (w - 80), 10 + R() * (h - 20), 20 + R() * 55, 4);
    }
    // 顶部标题条
    g.fillStyle = "rgba(0,0,0,.45)";
    g.fillRect(0, 0, w, 14);
    g.fillStyle = "#ff5b5b";
    g.beginPath();
    g.arc(12, 7, 4, 0, 6.284);
    g.fill();
  });

  const tvUnit = new THREE.Group();
  const tvBody = new THREE.Mesh(roundedBox(1.4, 0.42, 0.38, 0.05, 3), furnMatWoodDark);
  tvBody.position.y = 0.21;
  const tvStand = new THREE.Mesh(roundedBox(0.3, 0.1, 0.22, 0.03, 2), furnMatWoodDark);
  tvStand.position.y = 0.47;
  const tvBezel = new THREE.Mesh(roundedBox(1.18, 0.72, 0.06, 0.03, 2), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.5, metalness: 0.3 }));
  tvBezel.position.y = 0.88;
  const tvScreenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.08, 0.62),
    new THREE.MeshBasicMaterial({ map: texScreen })
  );
  tvScreenMesh.position.set(0, 0.88, 0.032);
  const tvGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.9),
    new THREE.MeshBasicMaterial({ map: texSmoke, color: 0x3d7bd0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  tvGlow.position.set(0, 0.88, 0.05);
  tvUnit.add(tvBody, tvStand, tvBezel, tvScreenMesh, tvGlow);
  addContactShadow(tvUnit, 1.5, 0.5, 0.6);
  addFurniture(tvUnit, 3.55, 4.5, 0.72, 0.21, "电视柜", 1.15);

  const sinkGroup = new THREE.Group();
  const counter = new THREE.Mesh(roundedBox(1.8, 0.9, 0.7, 0.04, 3), furnMatMetal);
  counter.position.y = 0.45;
  const basin = new THREE.Mesh(roundedBox(1.0, 0.16, 0.45, 0.04, 3), new THREE.MeshStandardMaterial({ color: 0x2a394d, roughness: 0.28, metalness: 0.9 }));
  basin.position.set(0, 0.95, 0);
  const tapBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), furnMatMetal);
  tapBase.position.set(0, 1.0, -0.26);
  const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.34, 12), furnMatMetal);
  tap.position.set(0, 1.17, -0.26);
  const tapHead = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 12), furnMatMetal);
  tapHead.rotation.z = Math.PI / 2;
  tapHead.position.set(0.06, 1.32, -0.26);
  sinkGroup.add(counter, basin, tapBase, tap, tapHead);
  addContactShadow(sinkGroup, 1.9, 0.8, 0.6);
  const sinkItem = addFurniture(sinkGroup, -4.1, 0.6, 0.9, 0.35, "水槽", 1.04);
  sinkItem.isSink = true;

  const door = new THREE.Mesh(
    roundedBox(1.3, 2.2, 0.12, 0.03, 2),
    new THREE.MeshStandardMaterial({ color: 0x2b3444, roughness: 0.75, metalness: 0.1 })
  );
  door.position.set(4.85, 1.1, -2.2);
  door.rotation.y = -Math.PI / 2;
  door.castShadow = true;
  scene.add(door);
  const doorHandle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), furnMatMetal);
  const wallMounted = [];   // 升级时要跟着墙一起移动的东西
  doorHandle.position.set(4.78, 1.05, -1.7);
  scene.add(doorHandle);
  wallMounted.push(door, doorHandle);
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x333c4a, roughness: 0.6, metalness: 0.2 });
  const dfTop = new THREE.Mesh(roundedBox(0.12, 0.1, 1.5, 0.02, 2), doorFrameMat);
  dfTop.position.set(4.9, 2.25, -2.2);
  scene.add(dfTop);
  const dfL = new THREE.Mesh(roundedBox(0.12, 2.3, 0.1, 0.02, 2), doorFrameMat);
  dfL.position.set(4.9, 1.15, -2.95);
  scene.add(dfL);
  const dfR = dfL.clone();
  dfR.position.z = -1.45;
  scene.add(dfR);
  wallMounted.push(dfTop, dfL, dfR, windowGroup);
  const DOOR_POS = new THREE.Vector3(4.2, 0, -2.2);

  const kitchenLight = new THREE.PointLight(0xffb066, 0.25, 9, 2);
  kitchenLight.position.set(-3.4, 2.2, 0.6);
  scene.add(kitchenLight);

  /* ---------- 带窗口的外墙：把 +x 墙拆成四块，让窗外真的能看到东西 ---------- */
  let windowWallGroup = null;
  function buildWindowWall() {
    if (windowWallGroup) {
      scene.remove(windowWallGroup);
      windowWallGroup.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      windowWallGroup = null;
    }
    const H = ROOM.half;
    const th = 0.3;
    const winW = 2.6, winH = 1.6, winY = 1.85, winZ = 1.9;
    const halfLen = (H * 2 + 0.4) / 2;
    const openingLo = winZ - winW / 2;
    const openingHi = winZ + winW / 2;
    const pieces = [
      // 窗口下方
      { w: th, h: winY - winH / 2, d: winW, y: (winY - winH / 2) / 2, z: winZ },
      // 窗口上方
      { w: th, h: ROOM.wallH - (winY + winH / 2), d: winW, y: (winY + winH / 2 + ROOM.wallH) / 2, z: winZ },
      // z 正侧
      { w: th, h: ROOM.wallH, d: halfLen - openingHi, y: ROOM.wallH / 2, z: (openingHi + halfLen) / 2 },
      // z 负侧
      { w: th, h: ROOM.wallH, d: openingLo + halfLen, y: ROOM.wallH / 2, z: (openingLo - halfLen) / 2 },
    ];
    windowWallGroup = new THREE.Group();
    for (const pc of pieces) {
      if (pc.h <= 0.01 || pc.d <= 0.01) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(pc.w, pc.h, pc.d), wallMat);
      m.position.set(H, pc.y, pc.z);
      m.castShadow = true;
      m.receiveShadow = true;
      windowWallGroup.add(m);
    }
    scene.add(windowWallGroup);
  }
  /* ---------- 直播设备：三脚架 + 手机 + 环形补光灯 ---------- */
  const rigGroup = new THREE.Group();
  const rigMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.6, metalness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6), rigMat);
    leg.position.set(Math.cos(a) * 0.22, 0.65, Math.sin(a) * 0.22);
    leg.rotation.z = Math.cos(a) * 0.16;
    leg.rotation.x = -Math.sin(a) * 0.16;
    leg.castShadow = true;
    rigGroup.add(leg);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), rigMat);
  pole.position.y = 1.45;
  rigGroup.add(pole);

  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.32, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x0d1117, emissive: 0x1b3a5c, emissiveIntensity: 0.7, roughness: 0.4 })
  );
  phone.position.set(0, 1.72, 0.04);
  phone.rotation.x = -0.22;
  rigGroup.add(phone);

  const ringLamp = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.025, 8, 26),
    new THREE.MeshBasicMaterial({ color: 0xfff4d6 })
  );
  ringLamp.position.set(0, 1.7, -0.08);
  ringLamp.rotation.x = -0.22;
  rigGroup.add(ringLamp);

  // 三脚架整体缩小并挪到墙边，把中间的过道让出来
  rigGroup.position.set(3.55, 0, 3.55);
  rigGroup.rotation.y = -0.5;
  rigGroup.scale.setScalar(0.82);
  scene.add(rigGroup);
  colliders.push({ x: 3.55, z: 3.55, hx: 0.17, hz: 0.17, tag: "prop", top: 1.6 });
  {
    const b = new CANNON.Body({ mass: 0, material: matGround });
    b.addShape(new CANNON.Box(new CANNON.Vec3(0.17, 0.8, 0.17)));
    b.position.set(3.55, 0.8, 3.55);
    world.addBody(b);
  }

  buildWindowWall();
  // 原来那面 +x 实心墙改为隐藏（它的碰撞体与物理体保留，防止箱子飞出去）
  for (const w of wallMeshes) { if (Math.abs(w.mesh.position.x - ROOM.half) < 0.01) w.mesh.visible = false; }
  const ringLight = new THREE.PointLight(0xfff0d8, 0.85, 7.5, 2);
  ringLight.position.set(3.4, 1.7, 3.4);
  scene.add(ringLight);

  /* ==================== 室外：黄昏城市背景 + 消防车 ==================== */
  /* ---------- 窗外：分层外景（远景天际线 / 中层楼群 / 街道 / 路灯 / 树） ---------- */
  const exteriorGroup = new THREE.Group();
  scene.add(exteriorGroup);

  // 远景：傍晚天空 + 天际线（更亮，带晚霞和月亮）
  const texSkyline = canvasTexture(768, 384, (g, w, h) => {
    const R = mulberry(20260215);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#3d5d90");
    sky.addColorStop(0.34, "#6f92be");
    sky.addColorStop(0.62, "#e0a094");
    sky.addColorStop(0.82, "#f0b57a");
    sky.addColorStop(1, "#ffd9a0");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // 星星（上半部分）
    for (let i = 0; i < 130; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + R() * 0.6})`;
      g.fillRect(R() * w, R() * h * 0.4, 1.6, 1.6);
    }
    // 月亮
    const moonX = w * 0.72, moonY = h * 0.16;
    const mg = g.createRadialGradient(moonX, moonY, 2, moonX, moonY, 46);
    mg.addColorStop(0, "rgba(255,250,225,1)");
    mg.addColorStop(0.35, "rgba(255,240,200,.85)");
    mg.addColorStop(1, "rgba(255,220,160,0)");
    g.fillStyle = mg;
    g.beginPath();
    g.arc(moonX, moonY, 46, 0, 6.284);
    g.fill();

    // 云带
    for (let i = 0; i < 16; i++) {
      const cy = h * (0.12 + R() * 0.35);
      const cw = 60 + R() * 150;
      g.fillStyle = `rgba(255,235,225,${0.05 + R() * 0.12})`;
      g.beginPath();
      g.ellipse(R() * w, cy, cw, 8 + R() * 14, 0, 0, 6.284);
      g.fill();
    }

    // 天际线：一栋栋楼，窗户亮着
    let x = -20;
    while (x < w) {
      const bw = 26 + R() * 54;
      const bh = 60 + R() * 170;
      const shade = 20 + R() * 16;
      g.fillStyle = `rgb(${shade},${shade + 8},${shade + 18})`;
      g.fillRect(x, h - bh, bw, bh);
      // 楼顶小灯
      g.fillStyle = "rgba(255,90,60,.9)";
      g.fillRect(x + bw / 2 - 1.5, h - bh - 5, 3, 4);
      // 窗户
      for (let wy = h - bh + 7; wy < h - 8; wy += 11) {
        for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
          if (R() < 0.62) {
            const warm = R();
            g.fillStyle = warm < 0.7
              ? `rgba(255,${205 + R() * 40},${130 + R() * 70},${0.65 + R() * 0.35})`
              : `rgba(${180 + R() * 60},${225 + R() * 30},255,${0.7 + R() * 0.3})`;
            g.fillRect(wx, wy, 4, 5);
          }
        }
      }
      x += bw + 3 + R() * 7;
    }
    // 地平线暖光
    const hz = g.createLinearGradient(0, h - 60, 0, h);
    hz.addColorStop(0, "rgba(255,200,150,0)");
    hz.addColorStop(1, "rgba(255,215,170,.5)");
    g.fillStyle = hz;
    g.fillRect(0, h - 60, w, 60);
  });

  const skyline = new THREE.Mesh(
    new THREE.PlaneGeometry(56, 28),
    new THREE.MeshBasicMaterial({ map: texSkyline, toneMapped: false })
  );
  skyline.position.set(ROOM.half + 11, 8.5, 1.9);
  skyline.rotation.y = -Math.PI / 2;
  exteriorGroup.add(skyline);

  // 中层：近一些的楼（带透明通道，做出前后层次）
  const texMidBuildings = canvasTexture(512, 256, (g, w, h) => {
    const R = mulberry(77123);
    g.clearRect(0, 0, w, h);
    let x = -10;
    while (x < w) {
      const bw = 40 + R() * 70;
      const bh = 70 + R() * 120;
      g.fillStyle = `rgba(${16 + R() * 10},${20 + R() * 12},${30 + R() * 14},.97)`;
      g.fillRect(x, h - bh, bw, bh);
      for (let wy = h - bh + 8; wy < h - 10; wy += 14) {
        for (let wx = x + 7; wx < x + bw - 8; wx += 12) {
          if (R() < 0.5) {
            g.fillStyle = `rgba(255,${200 + R() * 45},${125 + R() * 70},${0.55 + R() * 0.4})`;
            g.fillRect(wx, wy, 6, 7);
          }
        }
      }
      // 霓虹招牌
      if (R() < 0.35) {
        g.fillStyle = R() < 0.5 ? "rgba(255,80,120,.9)" : "rgba(90,220,255,.9)";
        g.fillRect(x + 6, h - bh + 6 + R() * 40, 10, 24);
      }
      x += bw + 6 + R() * 10;
    }
  });

  const midBuildings = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 20),
    new THREE.MeshBasicMaterial({ map: texMidBuildings, transparent: true, toneMapped: false })
  );
  midBuildings.position.set(ROOM.half + 7.6, 3.1, 1.9);
  midBuildings.rotation.y = -Math.PI / 2;
  exteriorGroup.add(midBuildings);

  // 街道：沥青 + 车道线
  const texRoad = canvasTexture(256, 256, (g, w, h) => {
    const R = mulberry(5150);
    g.fillStyle = "#3a3f49";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},${R() * 0.05})`;
      g.fillRect(R() * w, R() * h, 2, 2);
    }
    // 中间虚线
    g.fillStyle = "rgba(240,230,180,.75)";
    for (let y = 0; y < h; y += 64) g.fillRect(w / 2 - 4, y, 8, 34);
  }, 3, 3);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 10),
    new THREE.MeshStandardMaterial({ map: texRoad, roughness: 0.85, metalness: 0.05 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(ROOM.half + 7, -0.02, 1.9);
  exteriorGroup.add(road);

  // 人行道 + 路缘
  const sidewalk = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.16, 22),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 })
  );
  sidewalk.position.set(ROOM.half + 1.8, 0.02, 1.9);
  exteriorGroup.add(sidewalk);
  const curb = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.26, 22),
    new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.85 })
  );
  curb.position.set(ROOM.half + 3.4, 0.06, 1.9);
  exteriorGroup.add(curb);

  // 路灯（暖光，同时把光洒进屋里）
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x2f3640, roughness: 0.6, metalness: 0.5 });
  const lampPost = new THREE.Group();
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 5.2, 10), lampPoleMat);
  lampPole.position.y = 2.6;
  const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8), lampPoleMat);
  lampArm.rotation.z = Math.PI / 2;
  lampArm.position.set(-0.72, 5.15, 0);
  const lampHead = new THREE.Mesh(roundedBox(0.5, 0.16, 0.3, 0.05, 2), lampPoleMat);
  lampHead.position.set(-1.4, 5.05, 0);
  const lampBulb2 = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false })
  );
  lampBulb2.position.set(-1.4, 4.95, 0);
  const bulbGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 12, 10),
    new THREE.MeshBasicMaterial({ map: texSmoke, color: 0xffc07a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  bulbGlow.position.copy(lampBulb2.position);
  lampPost.add(lampPole, lampArm, lampHead, lampBulb2, bulbGlow);
  lampPost.position.set(ROOM.half + 2.0, 0, -1.6);
  exteriorGroup.add(lampPost);

  const streetLight = new THREE.PointLight(0xffc98a, 3.2, 22, 2);
  streetLight.position.set(ROOM.half + 0.9, 4.9, -1.6);
  exteriorGroup.add(streetLight);

  // 树（低多边形）
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
  for (const tz of [4.6, -4.2]) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.5, 8), trunkMat);
    trunk.position.y = 0.75;
    const crown1 = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), treeMat);
    crown1.position.y = 2.1;
    crown1.scale.set(1, 0.85, 1);
    const crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), treeMat);
    crown2.position.set(0.5, 2.7, 0.2);
    tree.add(trunk, crown1, crown2);
    tree.position.set(ROOM.half + 2.2, 0.08, tz);
    exteriorGroup.add(tree);
  }

  // 窗内透进来的暖光（街道灯 + 室内过渡）
  const duskLight = new THREE.PointLight(0xffbe8a, 1.6, 16, 1.6);
  duskLight.position.set(ROOM.half + 1.0, 2.3, 1.9);
  exteriorGroup.add(duskLight);
  /* ---------- 消防车（停在墙外，从窗口往室内喷水） ---------- */
  const truck = new THREE.Group();
  {
    const red = new THREE.MeshStandardMaterial({ color: 0xd22a24, roughness: 0.45, metalness: 0.25 });
    const darkRed = new THREE.MeshStandardMaterial({ color: 0x8c1616, roughness: 0.5, metalness: 0.2 });
    const silver = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.3, metalness: 0.85 });
    const glassMat2 = new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.2, metalness: 0.6, emissive: 0x0a1420 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.9 });

    const chassis = new THREE.Mesh(roundedBox(2.2, 0.5, 4.6, 0.08, 2), darkRed);
    chassis.position.y = 0.85;
    const bodyMain = new THREE.Mesh(roundedBox(2.1, 1.5, 3.0, 0.1, 3), red);
    bodyMain.position.set(0, 1.85, -0.5);
    const cab = new THREE.Mesh(roundedBox(2.05, 1.25, 1.5, 0.12, 3), red);
    cab.position.set(0, 1.7, 1.65);
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), glassMat2);
    windshield.position.set(0, 1.95, 2.41);
    const equip = new THREE.Mesh(roundedBox(1.9, 1.1, 1.4, 0.08, 2), silver);
    equip.position.set(0, 1.9, -1.6);
    const ladder = new THREE.Mesh(roundedBox(0.5, 0.16, 3.6, 0.04, 2), silver);
    ladder.position.set(0, 2.72, -0.4);
    const ladder2 = new THREE.Mesh(roundedBox(0.5, 0.16, 3.6, 0.04, 2), silver);
    ladder2.position.set(0, 2.95, -0.4);

    const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.34, 14);
    for (const w of [[-1.05, 1.6], [1.05, 1.6], [-1.05, -1.5], [1.05, -1.5]]) {
      const wheel = new THREE.Mesh(wheelGeo, rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(w[0], 0.52, w[1]);
      truck.add(wheel);
    }

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    beacon.position.set(0, 2.5, 1.9);
    const beaconGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 12, 10),
      new THREE.MeshBasicMaterial({ map: texSmoke, color: 0xff3b30, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    beaconGlow.position.copy(beacon.position);

    const nozzlePivot = new THREE.Group();
    const nozzleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.9, 12), silver);
    nozzleMesh.rotation.z = Math.PI / 2;
    nozzleMesh.position.set(-0.62, 0, 0);
    nozzlePivot.add(nozzleMesh);
    nozzlePivot.position.set(-0.95, 2.3, 0.9);

    truck.add(chassis, bodyMain, cab, windshield, equip, ladder, ladder2, beacon, beaconGlow, nozzlePivot);
    truck.userData.beacon = beacon;
    truck.userData.beaconGlow = beaconGlow;
    truck.userData.nozzle = nozzlePivot;
  }
  truck.position.set(ROOM.half + 14, 0, 1.9);
  truck.rotation.y = Math.PI;
  scene.add(truck);

  /* ---------- 室内灌水：消防车喷水时逐渐涨起来，火灭后慢慢褪去 ---------- */
  const texRipple = canvasTexture(256, 256, (g, w, h) => {
    const R = mulberry(65432);
    g.fillStyle = "#2f6d94";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const cx = R() * w, cy = R() * h, r = 6 + R() * 26;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, "rgba(190,235,255,.55)");
      grd.addColorStop(1, "rgba(60,130,175,0)");
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, 6.284);
      g.fill();
    }
  }, 4, 4);

  const floodMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.half * 2 - 0.3, ROOM.half * 2 - 0.3),
    new THREE.MeshStandardMaterial({
      map: texRipple,
      color: 0x4f9ec8,
      transparent: true,
      opacity: 0,
      roughness: 0.08,
      metalness: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  floodMesh.rotation.x = -Math.PI / 2;
  floodMesh.position.set(0, 0.02, 0);
  floodMesh.visible = false;
  scene.add(floodMesh);

  const flood = { level: 0, target: 0 };
  function updateFlood(dt) {
    const rate = flood.target > flood.level ? 0.55 : 0.16;   // 涨得快、退得慢
    flood.level += clamp(flood.target - flood.level, -rate * dt, rate * dt);
    flood.level = Math.max(0, flood.level);
    const on = flood.level > 0.012;
    floodMesh.visible = on;
    if (on) {
      floodMesh.position.y = flood.level + Math.sin(state.time * 2.4) * 0.006;
      floodMesh.material.opacity = clamp(0.3 + flood.level * 0.5, 0, 0.55);
      texRipple.offset.x += dt * 0.02;
      texRipple.offset.y += dt * 0.012;
    }
  }
  const beaconLight = new THREE.PointLight(0xff3322, 0, 20, 2);
  beaconLight.position.set(ROOM.half + 2.6, 2.6, 1.9);
  scene.add(beaconLight);

  /* 水柱：从水炮抛一条弧线到目标点，落点后触发回调 */
  const activeSprays = [];
  function sprayAt(targetX, targetY, targetZ, onArrive) {
    const start = new THREE.Vector3();
    truck.userData.nozzle.getWorldPosition(start);
    const end = new THREE.Vector3(targetX, targetY, targetZ);
    const mid = start.clone().lerp(end, 0.5);
    mid.y = Math.max(start.y, end.y) + 1.8;

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.075, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.85 });
    const drops = [];
    for (let i = 0; i < 16; i++) {
      const d = new THREE.Mesh(geo, mat.clone());
      d.visible = false;
      group.add(d);
      drops.push(d);
    }
    scene.add(group);
    activeSprays.push({ curve, drops, group, t: 0, onArrive, done: false });
  }

  function updateSprays(dt) {
    for (const s of activeSprays) {
      s.t += dt * 1.3;
      const head = clamp(s.t, 0, 1);
      for (let i = 0; i < s.drops.length; i++) {
        const off = (i / s.drops.length) * 0.34;
        const tt = head - off;
        if (tt < 0) { s.drops[i].visible = false; continue; }
        s.drops[i].visible = true;
        s.drops[i].position.copy(s.curve.getPoint(clamp(tt, 0, 1)));
        s.drops[i].material.opacity = 0.85 * clamp(1 - off * 2.2, 0.2, 1);
      }
      if (s.t >= 1.05 && !s.done) {
        s.done = true;
        if (s.onArrive) s.onArrive();
      }
    }
    for (let i = activeSprays.length - 1; i >= 0; i--) {
      if (activeSprays[i].t > 1.9) {
        scene.remove(activeSprays[i].group);
        activeSprays.splice(i, 1);
      }
    }
  }

  /* ==================== 手持物 ==================== */
  const handGroup = new THREE.Group();
  camera.add(handGroup);
  scene.add(camera);

  const matKnifeBlade = new THREE.MeshStandardMaterial({ color: 0xd9e2ec, roughness: 0.2, metalness: 0.85 });
  const matHandle = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7 });

  const knife = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.15, 0.34), matKnifeBlade);
  blade.position.set(0, 0, -0.16);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.16), matHandle);
  handle.position.set(0, 0, 0.04);
  knife.add(blade, handle);

  const lighter = new THREE.Group();
  const lBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.11, 0.035),
    new THREE.MeshStandardMaterial({ color: 0xd94f4f, roughness: 0.45 })
  );
  const lTop = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.02, 0.03), matHandle);
  lTop.position.y = 0.06;
  lighter.add(lBody, lTop);
  const lighterFlame = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, 0.14),
    new THREE.MeshBasicMaterial({
      map: texFlame, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  lighterFlame.position.y = 0.15;
  lighterFlame.visible = false;
  lighter.add(lighterFlame);

  const bucket = new THREE.Group();
  const bBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.11, 0.26, 14, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x3f6fa8, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide,
    })
  );
  const bWater = new THREE.Mesh(
    new THREE.CylinderGeometry(0.125, 0.1, 0.2, 14),
    new THREE.MeshStandardMaterial({ color: 0x7fd7ff, transparent: true, opacity: 0.8, roughness: 0.15 })
  );
  bWater.position.y = -0.02;
  bWater.visible = false;
  bucket.add(bBody, bWater);

  // 扫帚（第 4 件工具，用来扫灰）
  const broom = new THREE.Group();
  {
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.75 });
    const bristleMat = new THREE.MeshStandardMaterial({ color: 0xd8bd77, roughness: 0.95 });
    // 做成"手举着"的比例：短杆 + 头部靠近握点，保证扫帚头在画面里
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.72, 8), handleMat);
    stick.position.set(0, 0.24, 0);
    const headWood = new THREE.Mesh(roundedBox(0.4, 0.07, 0.14, 0.02, 2), handleMat);
    headWood.position.set(0, -0.14, 0);
    const bristles = new THREE.Mesh(roundedBox(0.44, 0.22, 0.2, 0.04, 2), bristleMat);
    bristles.position.set(0, -0.3, 0);
    broom.add(stick, headWood, bristles);
    broom.scale.setScalar(1.15);
    broom.position.set(-0.02, 0.14, 0.1);
    broom.rotation.set(0.32, 0.22, 0.55);
  }

  const hands = { knife: knife, lighter: lighter, bucket: bucket, broom: broom };
  const HAND_POS = new THREE.Vector3(0.3, -0.26, -0.52);
  for (const k in hands) {
    hands[k].position.copy(HAND_POS);
    hands[k].scale.setScalar(0.42);
    hands[k].visible = false;
    handGroup.add(hands[k]);
  }
  hands.knife.rotation.set(-0.2, 0.15, 0.25);
  hands.lighter.rotation.set(-0.25, 0.2, 0.1);
  hands.bucket.rotation.set(-0.1, 0.1, 0.05);

  // 手里拿着的食材（拾取后显示在左下方，随烤制变色）
  const heldFoodMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
  );
  heldFoodMesh.scale.set(1, 0.8, 1);
  heldFoodMesh.position.set(-0.17, -0.19, -0.4);
  heldFoodMesh.visible = false;
  handGroup.add(heldFoodMesh);

  /* ==================== 游戏状态 ==================== */
  const state = {
    running: false,
    fans: 0,
    heat: 0,
    cumulativeHeat: 0,
    hp: 100,
    money: 300,
    water: 0,
    tool: "knife",
    held: null,
    heldCook: 0,
    carried: null,
    eaten: 0,
    interrupted: 0,
    reported: false,
    complaintShown: false,
    legCooldown: 0,
    gameOver: false,
    lastHurt: -99,
    abilities: {},
    time: 0,
  };

  const ui = {
    fans: document.getElementById("fans"),
    hp: document.getElementById("hp"),
    heat: document.getElementById("heat"),
    money: document.getElementById("money"),
    water: document.getElementById("water"),
    fanBar: document.querySelector("#fanBar > i"),
    healthFill: document.getElementById("healthFill"),
    healthHud: document.getElementById("healthHud"),
    heatBar: document.querySelector("#heatBar > i"),
    tools: document.querySelectorAll("#tools .tool"),
    prompt: document.getElementById("prompt"),
    danmaku: document.getElementById("danmaku"),
    abilities: document.getElementById("abilities"),
    event: document.getElementById("event"),
    flash: document.getElementById("flash"),
    overlay: document.getElementById("overlay"),
    lockHint: document.getElementById("lockHint"),
    hurtOverlay: document.getElementById("hurtOverlay"),
    hurtText: document.getElementById("hurtText"),
    banner: document.getElementById("interruptBanner"),
    bannerSub: document.querySelector("#interruptBanner .sub"),
    bannerCount: document.querySelector("#interruptBanner .count"),
  };

  /* ==================== 像素火焰（MC 风格） ==================== */
  const PIX = 16;
  // 三帧 16×16 像素火，NearestFilter 放大 → 方块颗粒感
  const texPixelFire = (() => {
    const frames = [];
    for (let f = 0; f < 3; f++) {
      const c = document.createElement("canvas");
      c.width = c.height = PIX;
      const g = c.getContext("2d");
      const img = g.createImageData(PIX, PIX);
      const R = mulberry(4242 + f * 977);
      for (let y = 0; y < PIX; y++) {
        const t = y / (PIX - 1);                       // 0 = 火焰尖，1 = 底部
        const halfW = (0.16 + t * 0.36) * PIX;
        const cx = PIX / 2 + Math.sin(f * 1.9 + t * 4.2) * 1.3;
        for (let x = 0; x < PIX; x++) {
          const dx = Math.abs(x - cx + 0.5);
          if (dx >= halfW) continue;
          const edge = 1 - dx / halfW;
          let alpha = edge * (0.65 + R() * 0.5);
          if (alpha < 0.15) continue;
          let r, gg, b;
          if (t > 0.74) { r = 255; gg = 248; b = 176; }
          else if (t > 0.48) { r = 255; gg = 176; b = 44; }
          else if (t > 0.24) { r = 226; gg = 96; b = 22; }
          else { r = 148; gg = 38; b = 12; }
          if (R() < 0.24) { r *= 0.68; gg *= 0.68; b *= 0.68; }
          const i4 = (y * PIX + x) * 4;
          img.data[i4] = r;
          img.data[i4 + 1] = gg;
          img.data[i4 + 2] = b;
          img.data[i4 + 3] = Math.min(255, alpha * 255);
        }
      }
      g.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.encoding = THREE.sRGBEncoding;
      frames.push(tex);
    }
    return frames;
  })();

  function pixelQuad(w, h) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: texPixelFire[0], transparent: true, alphaTest: 0.14, depthWrite: false,
        toneMapped: false,      // 像素火不要被色调映射压灰
      })
    );
    return m;
  }

  /*
   * 火焰装配：三个层级，随碳化程度逐层点亮
   *   top   —— 只烧箱顶
   *   sides —— 蔓延到箱子四周
   *   big   —— 整个箱子包住（此时才会点燃地板）
   * 装配以"物体底面中心"为原点。
   */
  function createFireRig(hx, hz, height) {
    const group = new THREE.Group();
    const top = new THREE.Group();
    const sides = new THREE.Group();
    const big = new THREE.Group();
    group.add(top, sides, big);

    const span = Math.max(hx * 2, hz * 2);
    // 顶部：四片交叉 + 高度错落，保证任意角度看都是立体的
    const topSize = Math.max(0.8, span * 1.25);
    for (let i = 0; i < 4; i++) {
      const q = pixelQuad(topSize * (0.8 + (i % 2) * 0.25), topSize * (0.9 + (i % 2) * 0.25));
      q.position.set(rand(-0.06, 0.06), height + topSize * (0.28 + (i % 2) * 0.18), rand(-0.06, 0.06));
      q.rotation.y = (i / 4) * Math.PI * 2 + 0.2;
      q.rotation.z = rand(-0.08, 0.08);
      top.add(q);
    }

    // 四周：每个面两片（第二片转 45°），形成体积感而不是"贴片"
    const sideH = Math.max(0.75, height * 1.35);
    const faceDefs = [
      { x: hx * 1.0, z: 0, rotY: Math.PI / 2, wide: hz * 2.6 },
      { x: -hx * 1.0, z: 0, rotY: Math.PI / 2, wide: hz * 2.6 },
      { x: 0, z: hz * 1.0, rotY: 0, wide: hx * 2.6 },
      { x: 0, z: -hz * 1.0, rotY: 0, wide: hx * 2.6 },
    ];
    for (const f of faceDefs) {
      for (let k = 0; k < 2; k++) {
        const q = pixelQuad(Math.max(0.6, f.wide) * (k === 0 ? 1 : 0.8), sideH * (k === 0 ? 1 : 0.85));
        q.position.set(f.x + f.x * 0.06 * k, height * (0.4 + k * 0.12), f.z + f.z * 0.06 * k);
        q.rotation.y = f.rotY + (k === 0 ? 0 : Math.PI / 4.2);
        q.rotation.z = rand(-0.06, 0.06);
        sides.add(q);
      }
    }

    // 整体吞没：五片环绕 + 一层低位火
    const bigSize = Math.max(1.05, span * 1.7);
    for (let i = 0; i < 5; i++) {
      const q = pixelQuad(bigSize * 0.95, bigSize * 1.3);
      q.position.set(rand(-0.08, 0.08), height * (0.45 + (i % 2) * 0.2), rand(-0.08, 0.08));
      q.rotation.y = (i / 5) * Math.PI * 2;
      q.rotation.z = rand(-0.07, 0.07);
      big.add(q);
    }
    for (let i = 0; i < 3; i++) {
      const q = pixelQuad(bigSize * 0.8, bigSize * 0.7);
      q.position.set(Math.cos(i * 2.1) * span * 0.4, height * 0.22, Math.sin(i * 2.1) * span * 0.4);
      q.rotation.y = i * 2.1;
      big.add(q);
    }

    top.visible = true;
    sides.visible = false;
    big.visible = false;
    return { group: group, top: top, sides: sides, big: big };
  }

  function itemObj(item) {
    return item.kind === "box" ? item.group : item.mesh;
  }

  /* 火焰光源池：光源数量固定，避免"每点一团火就多一个点光源"导致掉帧与着色器重编译 */
  const FIRE_LIGHT_POOL_SIZE = 2;
  const fireLightSlots = [];
  for (let i = 0; i < FIRE_LIGHT_POOL_SIZE; i++) {
    const l = new THREE.PointLight(0xff8a3c, 0, 9, 2);
    l.position.set(0, -50, 0);
    scene.add(l);
    fireLightSlots.push({ light: l, owner: null });
  }

  function acquireFireLight(owner) {
    let slot = fireLightSlots.find((s) => s.owner === null);
    if (!slot) {
      // 池满了：让最后加入的那团火独占一盏，其余只保留可见火焰
      slot = fireLightSlots[fireLightSlots.length - 1];
      if (slot.owner && slot.owner.burn) slot.owner.burn.slot = null;
    }
    slot.owner = owner;
    slot.light.intensity = 1.4;
    return slot;
  }

  function releaseFireLight(owner) {
    for (const s of fireLightSlots) {
      if (s.owner !== owner) continue;
      s.owner = null;
      s.light.intensity = 0;
      s.light.position.set(0, -50, 0);
    }
  }

  function startBurning(item) {
    if (item.burn) return;
    const isBox = item.kind === "box";

    // 火焰装配以"底面中心"为原点
    let hx, hz, height, baseY;
    if (isBox) {
      hx = item.size.x / 2;
      hz = item.size.z / 2;
      height = item.size.y;
      baseY = item.group.position.y - height / 2;
    } else {
      hx = item.collider ? item.collider.hx : 0.6;
      hz = item.collider ? item.collider.hz : 0.6;
      height = Math.min(1.4, item.collider && item.collider.top ? item.collider.top : 0.9);
      baseY = 0;
    }

    const rig = createFireRig(hx, hz, height);
    rig.group.position.set(itemObj(item).position.x, baseY, itemObj(item).position.z);
    scene.add(rig.group);

    const slot = acquireFireLight(item);
    if (slot) slot.light.position.set(rig.group.position.x, baseY + height + 0.4, rig.group.position.z);

    item.burn = {
      rig: rig,
      slot: slot,
      carbon: 0,
      life: isBox ? TUNE.boxBurnTime : TUNE.furnBurnTime,
      born: state.time,
      flicker: Math.random() * 10,
      stage: 0,
      radius: Math.max(hx, hz) + 0.55,
      height: height,
      baseY: baseY,
      frame: 0,
      frameT: 0,
      isFloor: false,
    };
    if (isBox) item.isBurning = true;
    fires.push(item);
    showEvent("点着了！", 700);
  }

  function stopBurning(item, message) {
    if (!item.burn) return;
    scene.remove(item.burn.rig.group);
    releaseFireLight(item);
    item.burn = null;
    if (item.kind === "box") item.isBurning = false;
    const i = fires.indexOf(item);
    if (i >= 0) fires.splice(i, 1);
    if (message) showEvent(message, 800);
  }

  /* ---------- 地面火：被"整体燃烧"的箱子点着，会蔓延 ---------- */
  const floorFires = [];
  function spawnFloorFire(x, z) {
    for (const f of floorFires) {
      if (Math.hypot(f.x - x, f.z - z) < 0.7) return null;
    }
    if (floorFires.length >= 10) return null;
    const rig = createFireRig(0.5, 0.5, 0.06);
    rig.group.position.set(x, 0.01, z);
    rig.top.visible = true;
    rig.sides.visible = true;
    scene.add(rig.group);
    const item = {
      kind: "floor",
      label: "地面火",
      x: x,
      z: z,
      rig: rig,
      burn: {
        rig: rig,
        carbon: 0,
        life: TUNE.floorFireTime,
        born: state.time,
        flicker: Math.random() * 10,
        stage: 1,
        radius: TUNE.floorFireRadius,
        height: 0.1,
        baseY: 0.01,
        frame: 0,
        frameT: 0,
        isFloor: true,
        slot: null,
      },
    };
    fires.push(item);
    floorFires.push(item);
    const slot = acquireFireLight(item);
    if (slot) {
      item.burn.slot = slot;
      slot.light.position.set(x, 0.7, z);
    }
    return item;
  }

  function stopFloorFire(item) {
    scene.remove(item.rig.group);
    releaseFireLight(item);
    const i = fires.indexOf(item);
    if (i >= 0) fires.splice(i, 1);
    const j = floorFires.indexOf(item);
    if (j >= 0) floorFires.splice(j, 1);
    item.burn = null;
  }

  /* ---------- 灰烬：箱子烧完后留下的痕迹 ---------- */
  const texAsh = canvasTexture(128, 128, (g, w, h) => {
    const R = mulberry(31337);
    g.clearRect(0, 0, w, h);
    // 外圈发散的灰
    for (let i = 0; i < 260; i++) {
      const a = R() * 6.284, r = Math.pow(R(), 0.6) * 56;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      const alpha = 0.5 * (1 - r / 60);
      g.fillStyle = `rgba(${30 + R() * 40},${26 + R() * 34},${24 + R() * 30},${alpha})`;
      g.beginPath();
      g.arc(x, y, 1 + R() * 5, 0, 6.284);
      g.fill();
    }
    // 中心焦黑
    const grd = g.createRadialGradient(64, 64, 2, 64, 64, 40);
    grd.addColorStop(0, "rgba(12,10,9,.85)");
    grd.addColorStop(0.6, "rgba(26,22,20,.55)");
    grd.addColorStop(1, "rgba(30,26,24,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(64, 64, 40, 0, 6.284);
    g.fill();
    // 几块没烧透的碎纸板
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(${70 + R() * 30},${50 + R() * 20},${34 + R() * 16},.9)`;
      g.save();
      g.translate(64 + (R() - 0.5) * 46, 64 + (R() - 0.5) * 46);
      g.rotate(R() * 3.14);
      g.fillRect(-4, -2.5, 8 + R() * 6, 5 + R() * 3);
      g.restore();
    }
  });

  const ashPiles = [];
  function spawnAshPile(x, z, size) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: texAsh,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rand(0, 6.28);
    mesh.position.set(x, 0.015, z);
    mesh.scale.setScalar((size || 0.9) * 1.5);
    mesh.renderOrder = 2;
    scene.add(mesh);
    ashPiles.push(mesh);
    mesh.userData.ash = { x: x, z: z, size: size || 0.9 };
    // 最多留 8 处灰烬
    while (ashPiles.length > 8) {
      const old = ashPiles.shift();
      scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
    return mesh;
  }

  // 把烧透的箱子彻底化为灰烬
  function burnBoxToAsh(box) {
    const pos = box.group.position.clone();
    const size = Math.max(box.size.x, box.size.z);
    if (state.carried === box) state.carried = null;
    if (box.pbody) {
      world.removeBody(box.pbody);
      box.pbody = null;
    }
    const ci = colliders.indexOf(box.collider);
    if (ci >= 0) colliders.splice(ci, 1);
    if (box.group.parent) box.group.parent.remove(box.group);
    const bi = boxes.indexOf(box);
    if (bi >= 0) boxes.splice(bi, 1);
    stopBurning(box);
    spawnAshPile(pos.x, pos.z, size);
    box.ash = true;
    showDanmaku("🔥 纸箱烧成灰了");
  }
  /* ==================== 快递箱 ==================== */
  const boxGeoBase = new THREE.BoxGeometry(1, 1, 1);
  const lidGeo = new THREE.BoxGeometry(1, 0.06, 1);

  function spawnParcel() {
    if (boxes.length >= TUNE.maxParcels) return;
    const w = rand(0.55, 0.95);
    const h = rand(0.5, 0.8);
    const d = rand(0.55, 0.95);
    const weight = rand(0.7, 1.8);

    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      map: texCardboard,
      bumpMap: texCardboardBump,
      bumpScale: 0.007,
      roughness: 0.88,
      metalness: 0.02,
      color: 0xffffff,
    });
    // 视觉模型必须以"箱子中心"为原点（物理体位置就是中心），否则会悬浮一半箱高
    const body = new THREE.Mesh(roundedBox(1, 1, 1, 0.035, 3), bodyMat);
    body.scale.set(w, h, d);
    body.position.y = 0;
    body.castShadow = true;
    body.receiveShadow = true;

    // 箱盖（带一点厚度和倒角）
    const lid = new THREE.Mesh(roundedBox(1, 1, 1, 0.02, 2), bodyMat);
    lid.scale.set(w, 0.05, d);
    lid.position.set(0, h / 2 + 0.02, 0);
    lid.castShadow = true;

    // 胶带（半透明）
    const tape = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.28, d * 1.02),
      new THREE.MeshStandardMaterial({ map: texTape, transparent: true, roughness: 0.45, metalness: 0.05 })
    );
    tape.rotation.x = -Math.PI / 2;
    tape.position.set(0, h / 2 + 0.05, 0);

    // 快递面单（每箱随机）
    const labelTex = makeLabelTexture(Math.floor(rand(1, 99999)));
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.42, h * 0.34),
      new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.75 })
    );
    label.position.set(w * 0.18, 0, d / 2 + 0.004);
    label.rotation.z = rand(-0.04, 0.04);

    group.add(body, lid, tape, label);
    // 接触阴影（跟着箱子走，旋转时一起转，够用）
    const shadow = addContactShadow(group, w * 0.9, d * 0.9, 0.5);
    shadow.position.y = -h / 2 + 0.012;
    group.position.copy(DOOR_POS).add(new THREE.Vector3(rand(-0.5, 0.5), 2.4, rand(-0.8, 0.8)));
    scene.add(group);

    const box = {
      kind: "box",
      group: group,
      body: body,
      lid: lid,
      bodyMat: bodyMat,
      size: new THREE.Vector3(w, h, d),
      weight: weight,
      vel: new THREE.Vector3(),
      cut: 0,
      opened: false,
      isBurning: false,
      burn: null,
      label: "快递箱",
      y: group.position.y,
    };
    // 碰撞体一开始就要带真实坐标，否则会在房间中心产生一帧幽灵碰撞
    box.collider = {
      x: group.position.x,
      z: group.position.z,
      hx: w / 2,
      hz: d / 2,
      top: h,
      tag: "box",
      box: box,
    };
    colliders.push(box.collider);

    // 刚体：质量随"重量"变化，落地/叠放/倾倒全部交给物理引擎
    const pbody = new CANNON.Body({
      mass: weight * 1.4,
      material: matBox,
      linearDamping: 0.02,
      angularDamping: 0.15,
      allowSleep: true,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.6,
    });
    pbody.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
    pbody.position.set(group.position.x, group.position.y, group.position.z);
    pbody.quaternion.setFromEuler(0, rand(-0.12, 0.12), 0);
    world.addBody(pbody);
    box.pbody = pbody;

    boxes.push(box);
    showDanmaku("📦 有新快递到了");
  }

  function syncBoxFromBody(b) {
    const p = b.pbody;
    b.group.position.set(p.position.x, p.position.y, p.position.z);
    b.group.quaternion.set(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w);

    // cannon 的 AABB 是惰性更新的，位置一变就必须手动重算，否则包围盒是旧值
    p.computeAABB();

    // 玩家碰撞体用刚体的水平包围盒（含旋转），避免穿模
    const lo = p.aabb.lowerBound;
    const hi = p.aabb.upperBound;
    b.collider.x = (lo.x + hi.x) / 2;
    b.collider.z = (lo.z + hi.z) / 2;
    b.collider.hx = (hi.x - lo.x) / 2;
    b.collider.hz = (hi.z - lo.z) / 2;
    b.collider.top = hi.y;

    if (b.burn) {
      const f = b.burn;
      const bottomY = hi.y - b.size.y;
      f.rig.group.position.set(p.position.x, bottomY, p.position.z);
      f.rig.group.rotation.y = b.group.rotation.y;
      if (f.slot && f.slot.owner === b) {
        f.slot.light.position.set(p.position.x, hi.y + 0.4, p.position.z);
      }
    }
  }

  const ashQueue = [];
  function updateBoxes(dt) {
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));

    for (const b of boxes) {
      // 被搬在手上的箱子：切成运动学刚体，跟着玩家走
      if (state.carried === b) {
        const px = player.pos.x + fwd.x * 0.85;
        const pz = player.pos.z + fwd.z * 0.85;
        b.pbody.position.set(px, 1.05, pz);
        b.pbody.velocity.set(0, 0, 0);
        b.pbody.angularVelocity.set(0, 0, 0);
        b.pbody.quaternion.setFromEuler(0, player.yaw, 0);
        b.group.position.set(px, 1.05, pz);
        b.group.quaternion.copy(b.pbody.quaternion);
        b.collider.x = 9999;
        b.collider.z = 9999;
        if (b.burn) {
          b.burn.rig.group.position.set(px, 1.05 - b.size.y / 2, pz);
          if (b.burn.slot) b.burn.slot.light.position.set(px, 1.7, pz);
        }
        continue;
      }

      syncBoxFromBody(b);

      // 兜底：万一被挤出地面掉到地板下，把它送回门口
      if (b.pbody.position.y < -0.6) {
        b.pbody.position.set(DOOR_POS.x, 1.6, DOOR_POS.z);
        b.pbody.velocity.set(0, 0, 0);
        b.pbody.angularVelocity.set(0, 0, 0);
        b.pbody.quaternion.setFromEuler(0, 0, 0);
        b.pbody.wakeUp();
        showDanmaku("📦 有快递被挤掉了，重新送来一个");
      }

      if (b.burn) {
        const f = b.burn;
        f.carbon = clamp(f.carbon + dt / TUNE.boxBurnTime, 0, 1);
        const dark = 1 - f.carbon * 0.92;
        b.bodyMat.color.setRGB(dark, dark * 0.96, dark * 0.92);
        // 烧的过程中箱子会一点点缩下去（被烧掉），最后化成灰
        const shrink = 1 - f.carbon * 0.35;
        b.group.scale.set(shrink, shrink, shrink);
        if (f.carbon >= 1 && !b.ashPending) {
          b.ashPending = true;
          ashQueue.push(b);
        }
      }
    }

    // 烧成灰的箱子在循环外统一移除
    while (ashQueue.length) {
      const dead = ashQueue.shift();
      if (!boxes.includes(dead)) continue;
      boxes.splice(boxes.indexOf(dead), 1);
      burnBoxToAsh(dead);
    }
  }

  /* ==================== 食材 ==================== */
  /* 每种食材一张程序贴图：颜色靠 material.color 做"生→熟"渐变，贴图提供细节 */
  const texPork = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = "#f7c9c4";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      const y = 12 + i * 24;
      g.fillStyle = "rgba(255,252,248,.95)";
      g.fillRect(0, y, w, 7);
      g.fillStyle = "rgba(200,90,90,.22)";
      g.fillRect(0, y + 7, w, 2);
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(${180 + Math.random() * 60},${90 + Math.random() * 60},${90 + Math.random() * 50},${Math.random() * 0.14})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
  }, 1, 1);

  const texPotato = canvasTexture(128, 128, (g, w, h) => {
    const R = mulberry(1234);
    g.fillStyle = "#dfc07a";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${120 + R() * 90},${90 + R() * 70},${40 + R() * 40},${R() * 0.28})`;
      const r = 1 + R() * 2.5;
      g.beginPath();
      g.arc(R() * w, R() * h, r, 0, 6.284);
      g.fill();
    }
  }, 1, 1);

  const texChicken = canvasTexture(128, 128, (g, w, h) => {
    const R = mulberry(4321);
    g.fillStyle = "#f4d3a8";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = `rgba(${190 + R() * 50},${140 + R() * 50},${90 + R() * 50},${R() * 0.2})`;
      g.fillRect(R() * w, R() * h, 1 + R() * 3, 1);
    }
  }, 1, 1);

  const texCorn = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = "#f2cf5b";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      for (let x = 0; x < w; x += 16) {
        const ox = (y / 16) % 2 === 0 ? 0 : 8;
        g.fillStyle = "rgba(255,236,150,.9)";
        g.beginPath();
        g.arc(x + ox + 8, y + 8, 5.5, 0, 6.284);
        g.fill();
        g.strokeStyle = "rgba(170,130,40,.35)";
        g.lineWidth = 1;
        g.stroke();
      }
    }
  }, 1, 1);

  /* 牛排：暗红肉色 + 脂肪纹路 */
  const texSteak = canvasTexture(128, 128, (g, w, h) => {
    const R = mulberry(777);
    g.fillStyle = "#a8443c";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i++) {
      g.strokeStyle = "rgba(245,225,215,.55)";
      g.lineWidth = 1 + R() * 2;
      g.beginPath();
      let x = R() * w, y = R() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (R() - 0.5) * 30;
        y += (R() - 0.5) * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 600; i++) {
      g.fillStyle = `rgba(${120 + R() * 80},${30 + R() * 40},${30 + R() * 40},${R() * 0.25})`;
      g.fillRect(R() * w, R() * h, 2, 2);
    }
  }, 1, 1);

  /* 披萨：芝士 + 番茄酱底 + 配料点 */
  const texPizza = canvasTexture(128, 128, (g, w, h) => {
    const R = mulberry(888);
    g.fillStyle = "#e8b45c";
    g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grd.addColorStop(0, "rgba(240,220,140,.95)");
    grd.addColorStop(1, "rgba(210,150,70,.9)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(64, 64, 62, 0, 6.284);
    g.fill();
    for (let i = 0; i < 16; i++) {
      const a = R() * 6.284, r = 12 + R() * 44;
      g.fillStyle = "rgba(180,50,40,.85)";
      g.beginPath();
      g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 5 + R() * 4, 0, 6.284);
      g.fill();
    }
    for (let i = 0; i < 10; i++) {
      const a = R() * 6.284, r = 10 + R() * 42;
      g.fillStyle = "rgba(80,140,60,.7)";
      g.beginPath();
      g.ellipse(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 4, 2.5, a, 0, 6.284);
      g.fill();
    }
  }, 1, 1);

  /* 烧烤串：肉块纹理 */
  const texSkewer = canvasTexture(128, 128, (g, w, h) => {
    const R = mulberry(999);
    g.fillStyle = "#c2703c";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${90 + R() * 70},${40 + R() * 40},${20 + R() * 30},${0.15 + R() * 0.3})`;
      g.fillRect(R() * w, R() * h, 6 + R() * 14, 4 + R() * 8);
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(255,230,190,${R() * 0.12})`;
      g.fillRect(R() * w, R() * h, 2, 1);
    }
  }, 1, 1);

  /* 鱼：银灰鳞片条纹 */
  const texFish = canvasTexture(128, 128, (g, w, h) => {
    const R = mulberry(1111);
    g.fillStyle = "#cfd8e0";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) {
      g.strokeStyle = "rgba(90,120,150,.45)";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + 3);
      g.stroke();
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(255,255,255,${R() * 0.35})`;
      g.fillRect(R() * w, R() * h, 3, 2);
    }
  }, 1, 1);

  /*
   * 食材定义：
   *   raw    —— 生（食材本色）
   *   cooked —— 熟（金黄焦褐，最好吃）
   *   burnt  —— 糊（炭黑，几乎没收益）
   *   r      —— 物理球半径
   *   mass   —— 质量
   */
  const FOOD_TYPES = [
    {
      name: "五花肉", map: texPork, raw: 0xfff0ec, cooked: 0x7d3c10, burnt: 0x0d0a08, r: 0.11, mass: 0.42,
      geo: () => roundedBox(0.28, 0.1, 0.2, 0.032, 3),
    },
    {
      name: "牛排", map: texSteak, raw: 0xc85a4c, cooked: 0x5a2a0c, burnt: 0x0c0908, r: 0.12, mass: 0.55,
      geo: () => roundedBox(0.24, 0.09, 0.19, 0.03, 3),
    },
    {
      name: "鸡腿", map: texChicken, raw: 0xfff2d8, cooked: 0x8f4a12, burnt: 0x0c0908, r: 0.1, mass: 0.38,
      geo: () => new THREE.CapsuleGeometry(0.062, 0.15, 6, 12),
      rotZ: 0.5, bone: true,
    },
    {
      name: "披萨", map: texPizza, raw: 0xffe6b4, cooked: 0xa1601e, burnt: 0x0d0b09, r: 0.13, mass: 0.35,
      geo: () => new THREE.CylinderGeometry(0.15, 0.15, 0.03, 18),
      rotX: -0.3,
    },
    {
      name: "烧烤串", map: texSkewer, raw: 0xdba07c, cooked: 0x6b2f0c, burnt: 0x0b0807, r: 0.11, mass: 0.3,
      geo: () => roundedBox(0.1, 0.075, 0.28, 0.03, 2),
      stick: true,
    },
    {
      name: "鱼", map: texFish, raw: 0xf2f0ea, cooked: 0x9c6a2a, burnt: 0x0d0b09, r: 0.12, mass: 0.5,
      geo: () => new THREE.SphereGeometry(0.13, 16, 12),
      scale: [1.5, 0.75, 0.55], tail: true,
    },
    {
      name: "土豆", map: texPotato, raw: 0xfff2c4, cooked: 0x91600f, burnt: 0x0d0b09, r: 0.11, mass: 0.34,
      geo: () => new THREE.SphereGeometry(0.115, 16, 12),
      scaleY: 0.82,
    },
    {
      name: "玉米", map: texCorn, raw: 0xfff6c8, cooked: 0x9c7a08, burnt: 0x0e0c09, r: 0.1, mass: 0.3,
      geo: () => new THREE.CylinderGeometry(0.056, 0.056, 0.25, 14),
      rotZ: Math.PI / 2,
    },
  ];

  function spawnFood(pos, typeIdx) {
    const t = FOOD_TYPES[typeIdx % FOOD_TYPES.length];
    const mat = new THREE.MeshStandardMaterial({ map: t.map, color: t.raw, roughness: 0.55, metalness: 0.02 });
    const mesh = new THREE.Mesh(t.geo(), mat);
    if (t.scaleY) mesh.scale.y = t.scaleY;
    if (t.scale) mesh.scale.set(t.scale[0], t.scale[1], t.scale[2]);
    if (t.rotZ) mesh.rotation.z = t.rotZ;
    if (t.rotX) mesh.rotation.x = t.rotX;
    mesh.position.copy(pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // 附加小件（骨头 / 竹签 / 鱼尾）
    if (t.bone) {
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.5 });
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.019, 0.13, 8), boneMat);
      bone.position.set(0, -0.1, 0);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), boneMat);
      knob.position.set(0, -0.17, 0);
      mesh.add(bone, knob);
    }
    if (t.stick) {
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6),
        new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.8 })
      );
      stick.rotation.x = Math.PI / 2;
      stick.position.z = 0.02;
      mesh.add(stick);
    }
    if (t.tail) {
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.12, 3),
        new THREE.MeshStandardMaterial({ map: t.map, color: t.raw, roughness: 0.6 })
      );
      tail.rotation.z = Math.PI / 2;
      tail.position.x = -0.2;
      mesh.add(tail);
    }

    // 物理体：食材会从箱子里掉出来、落在桌面或地上，而不是浮在箱顶
    const pbody = new CANNON.Body({
      mass: t.mass,
      material: matBox,
      linearDamping: 0.08,
      angularDamping: 0.35,
      allowSleep: true,
      sleepSpeedLimit: 0.14,
      sleepTimeLimit: 0.5,
    });
    pbody.addShape(new CANNON.Sphere(t.r));
    pbody.position.set(pos.x, pos.y, pos.z);
    pbody.quaternion.setFromEuler(0, rand(0, 6.28), 0);
    world.addBody(pbody);

    const food = { kind: "food", mesh: mesh, mat: mat, type: t, cook: 0, label: t.name, pbody: pbody, baseScale: mesh.scale.clone() };
    foods.push(food);
    return food;
  }

  /* 食材的物理同步 */
  function updateFoods(dt) {
    for (const f of foods) {
      if (f === state.held || !f.pbody) continue;
      const p = f.pbody;
      f.mesh.position.set(p.position.x, p.position.y, p.position.z);
      f.mesh.quaternion.set(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w);
      // 掉出地板就送回门口
      if (p.position.y < -0.6) {
        p.position.set(DOOR_POS.x, 1.3, DOOR_POS.z);
        p.velocity.set(0, 0, 0);
        p.wakeUp();
      }
    }
    void dt;
  }

  /* ==================== 交互射线 ==================== */
  function interactiveTargets() {
    const arr = [];
    for (const b of boxes) {
      if (b === state.carried) continue;
      arr.push({ obj: b, meshes: [b.body, b.lid] });
    }
    for (const f of foods) {
      if (f === state.held) continue;
      arr.push({ obj: f, meshes: [f.mesh] });
    }
    for (const it of burnables) arr.push({ obj: it, meshes: it.childMeshes });
    return arr;
  }

  const raycaster = new THREE.Raycaster();
  raycaster.far = 3.4;
  const screenCenter = new THREE.Vector2(0, 0);
  let focus = null;

  function updateFocus() {
    raycaster.setFromCamera(screenCenter, camera);
    const table = interactiveTargets();
    let best = null;
    let bestDist = Infinity;
    for (const entry of table) {
      const hits = raycaster.intersectObjects(entry.meshes, false);
      if (hits.length && hits[0].distance < bestDist) {
        bestDist = hits[0].distance;
        best = entry.obj;
      }
    }
    focus = best && bestDist < 3.2 ? best : null;
  }

  /* ==================== 玩家 ==================== */
  const player = {
    pos: new THREE.Vector3(0, TUNE.eyeHeight, 4.2),
    yaw: 0,
    pitch: 0,
    bob: 0,
    vy: 0,
    feet: 0,        // 物理意义上的脚下高度（不含走路晃动）
    onGround: true,
    coyote: 0,      // 刚离开地面的宽限时间，允许"边缘起跳"
  };

  const keys = Object.create(null);
  let mouseDown = false;
  let cutting = null;
  let filling = 0;

  function boxTop(b) {
    return b.group.position.y + b.size.y / 2;
  }

  // 每个碰撞体的顶面高度：箱子是动态的，家具/墙在创建时给定
  function colliderTop(c) {
    if (c.box) return c.top !== undefined ? c.top : boxTop(c.box);
    return c.top === undefined ? 99 : c.top;
  }

  // 脚下能踩到的最高平面（地面 / 箱顶 / 家具顶面）
  function supportHeightAt(x, z, feet) {
    let support = 0;
    const pad = TUNE.playerRadius * 0.55;
    for (const c of colliders) {
      if (c.box && c.box === state.carried) continue;
      const top = colliderTop(c);
      if (top > feet + 0.35) continue;             // 太高，踩不上去
      if (Math.abs(x - c.x) < c.hx + pad && Math.abs(z - c.z) < c.hz + pad) {
        if (top > support) support = top;
      }
    }
    return support;
  }

  function playerCollide(nextX, nextZ, feet) {
    const r = TUNE.playerRadius;
    for (const c of colliders) {
      if (c.box && c.box === state.carried) continue;     // 手上的箱子不挡自己
      // 脚底接近顶面时放行（宽容 0.28 米），跳上桌面/箱顶不会因差一帧被卡住
      if (feet >= colliderTop(c) - 0.28) continue;
      if (
        nextX > c.x - c.hx - r && nextX < c.x + c.hx + r &&
        nextZ > c.z - c.hz - r && nextZ < c.z + c.hz + r
      ) return c;
    }
    return null;
  }

  function tryPushBox(collider, dirX, dirZ, dt) {
    const b = collider.box;
    if (!b || !b.pbody) return false;
    const p = b.pbody;
    if (p.type !== CANNON.Body.DYNAMIC) return false;
    // 推力要能克服摩擦才会滑动：普通推动 ≈ 14 m/s²，解锁腿力后更猛
    const accel = state.abilities.leg ? 26 : 14;
    p.wakeUp();
    p.applyForce(new CANNON.Vec3(dirX * accel * p.mass, 0, dirZ * accel * p.mass), p.position);
    void dt;
    return true;
  }

  // 玩家与箱子重叠时，沿"最小穿透方向"把玩家推出去（绝不瞬移到箱子另一侧）
  function resolveBoxOverlap(b, px, pz) {
    const r = TUNE.playerRadius;
    const minX = b.group.position.x - b.size.x / 2 - r;
    const maxX = b.group.position.x + b.size.x / 2 + r;
    const minZ = b.group.position.z - b.size.z / 2 - r;
    const maxZ = b.group.position.z + b.size.z / 2 + r;
    if (px <= minX || px >= maxX || pz <= minZ || pz >= maxZ) return null;  // 没重叠

    const outLeft = px - minX;
    const outRight = maxX - px;
    const outTop = pz - minZ;
    const outBottom = maxZ - pz;
    const m = Math.min(outLeft, outRight, outTop, outBottom);

    if (m === outLeft) return [minX - 0.002, pz];
    if (m === outRight) return [maxX + 0.002, pz];
    if (m === outTop) return [px, minZ - 0.002];
    return [px, maxZ + 0.002];
  }

  function updatePlayer(dt) {
    const carrySlow = state.carried ? 0.8 : 1;
    const waterSlow = flood.level > 0.12 ? 0.68 : 1;   // 屋里灌水时涉水减速
    const speed = TUNE.moveSpeed * (state.abilities.speed ? 1.35 : 1) * (keys.shift ? 1.45 : 1) * carrySlow * waterSlow;
    let ix = 0;
    let iz = 0;
    if (keys.w) iz -= 1;
    if (keys.s) iz += 1;
    if (keys.a) ix -= 1;
    if (keys.d) ix += 1;
    const len = Math.hypot(ix, iz);
    if (len > 0) {
      ix /= len;
      iz /= len;
    }

    // 把局部输入 (ix: 右, iz: 后) 转到世界坐标：
    //   rightWorld   = ( cos yaw, 0, -sin yaw)
    //   forwardWorld = (-sin yaw, 0, -cos yaw)
    // 因此 wz 的 sin 项要取负，wx 的 sin 项取正
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const wx = ix * cos + iz * sin;
    const wz = -ix * sin + iz * cos;

    let nx = player.pos.x + wx * speed * dt;
    let nz = player.pos.z + wz * speed * dt;

    const bound = ROOM.half - TUNE.playerRadius - 0.15;
    nx = clamp(nx, -bound, bound);
    nz = clamp(nz, -bound, bound);

    let feet = player.feet;
    const hit = playerCollide(nx, nz, feet);
    if (hit) {
      let resolved = null;
      if (hit.tag === "box") {
        tryPushBox(hit, wx, wz, dt);                 // 先把箱子往前推一点
        resolved = resolveBoxOverlap(hit.box, nx, nz);
      }
      if (resolved && !playerCollide(resolved[0], resolved[1], feet)) {
        nx = resolved[0];
        nz = resolved[1];
      } else {
        nx = player.pos.x;
        nz = player.pos.z;
      }
    }

    player.pos.x = nx;
    player.pos.z = nz;

    // ---- 竖直运动：重力、落地、踩箱子 ----
    player.vy -= TUNE.gravity * dt;
    feet += player.vy * dt;
    const support = supportHeightAt(nx, nz, feet);
    if (feet <= support) {
      feet = support;
      player.vy = 0;
      player.onGround = true;
      player.coyote = TUNE.coyoteTime;
    } else {
      player.onGround = false;
      player.coyote = Math.max(0, player.coyote - dt);
    }
    player.feet = feet;

    // 天花板硬上限：跳得再高，眼睛也不会穿出屋顶
    const headroom = ROOM.wallH - TUNE.eyeHeight - 0.12;
    if (player.feet > headroom) {
      player.feet = headroom;
      if (player.vy > 0) player.vy = 0;
    }

    if (len > 0 && player.onGround) player.bob += dt * (keys.shift ? 13 : 9);
    const bobY = Math.sin(player.bob) * (len > 0 && player.onGround ? 0.028 : 0);

    // 视觉晃动只作用于相机，不参与物理高度，避免 onGround 每帧闪烁
    player.pos.y = TUNE.eyeHeight + player.feet + bobY;
    camera.position.copy(player.pos);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(player.yaw);
    camera.rotateX(player.pitch);

    handGroup.position.y = bobY * 0.6;
  }

  /* ==================== 工具使用 ==================== */
  function setTool(tool) {
    state.tool = tool;
    for (const k in hands) hands[k].visible = k === tool;
    ui.tools.forEach((el) => el.classList.toggle("active", el.dataset.tool === tool));
  }

  function pickFood() {
    if (state.held) return;
    if (focus && focus.kind === "food") {
      state.held = focus;
      state.heldCook = focus.cook;
      // 拿在手上就不参与物理了，移出物理世界
      if (focus.pbody) {
        world.removeBody(focus.pbody);
        focus.pbody = null;
      }
      // 把食材本身的模型挂到手上（保持造型不变，而不是换成球）
      const m = focus.mesh;
      if (m.parent) m.parent.remove(m);
      m.scale.copy(focus.baseScale).multiplyScalar(0.85);
      m.position.set(-0.15, -0.17, -0.42);
      m.quaternion.set(0, 0, 0, 1);
      m.rotation.set(0.35, 0.7, 0.15);
      m.visible = true;
      handGroup.add(m);
      focus.inHand = true;
      showEvent("拿起了" + focus.type.name, 800);
    }
  }

  // 放下手中的食材（Q 键）：重新变回物理对象落在地上
  function dropHeld() {
    if (!state.held) {
      showEvent("手里没东西可放", 800);
      return;
    }
    const f = state.held;
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const px = player.pos.x + fwd.x * 0.9;
    const pz = player.pos.z + fwd.z * 0.9;
    const surface = supportHeightAt(px, pz, 1.2);
    const y = surface + 0.16;

    if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    f.mesh.scale.copy(f.baseScale || f.mesh.scale);
    f.mesh.rotation.set(0, rand(0, Math.PI * 2), 0);
    f.mesh.position.set(px, y, pz);
    f.mesh.visible = true;
    scene.add(f.mesh);
    f.inHand = false;

    const pbody = new CANNON.Body({
      mass: f.type.mass,
      material: matBox,
      linearDamping: 0.08,
      angularDamping: 0.35,
      allowSleep: true,
    });
    pbody.addShape(new CANNON.Sphere(f.type.r));
    pbody.position.set(px, y, pz);
    pbody.velocity.set(fwd.x * 0.4, 0.2, fwd.z * 0.4);
    world.addBody(pbody);
    f.pbody = pbody;

    state.held = null;
    state.heldCook = 0;
    showEvent("放下了" + f.type.name + "（" + cookStageName(f.cook) + "）", 900);
  }

  function cookStageName(k) {
    return k < 0.3 ? "生的" : k <= 0.8 ? "正好" : "糊了";
  }

  /* ---------- 扫帚：扫掉地上的灰烬 ---------- */
  let broomSwingT = 0;
  function broomSwing() {
    broomSwingT = 0.36;
  }

  function dustPuff(x, z) {
    const group = new THREE.Group();
    const baseMat = new THREE.MeshBasicMaterial({
      map: texSmoke, color: 0xb9ab99, transparent: true, opacity: 0.55, depthWrite: false,
    });
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), baseMat.clone());
      p.position.set(rand(-0.2, 0.2), rand(0.06, 0.3), rand(-0.2, 0.2));
      p.userData.dir = new THREE.Vector3(rand(-0.7, 0.7), rand(0.25, 0.85), rand(-0.7, 0.7));
      group.add(p);
    }
    group.position.set(x, 0.05, z);
    scene.add(group);
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 620;
      if (k >= 1) { scene.remove(group); return; }
      group.children.forEach((p) => {
        p.position.addScaledVector(p.userData.dir, 0.015);
        p.scale.setScalar(0.6 + k * 1.4);
        p.material.opacity = 0.55 * (1 - k);
        p.lookAt(camera.position);
      });
      requestAnimationFrame(anim);
    };
    anim();
  }

  function sweepAsh() {
    let best = null;
    let bestD = 2.8;
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    for (const a of ashPiles) {
      const info = a.userData.ash;
      if (!info) continue;
      const dx = info.x - player.pos.x;
      const dz = info.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || d < 0.01) continue;
      const dot = (dx / d) * fwd.x + (dz / d) * fwd.z;
      if (dot < 0.3) continue;      // 必须朝着它
      bestD = d;
      best = a;
    }
    if (!best) {
      showEvent("这里没有灰可扫", 800);
      return;
    }
    broomSwing();
    dustPuff(best.userData.ash.x, best.userData.ash.z);
    scene.remove(best);
    best.geometry.dispose();
    best.material.dispose();
    const idx = ashPiles.indexOf(best);
    if (idx >= 0) ashPiles.splice(idx, 1);
    state.money += 10;
    showEvent("扫干净了 · 观众打赏 +10 元", 1100);
    showDanmaku("【观众】主播真勤快，打扫得真干净");
  }
  function eatHeld() {
    if (!state.held) return;
    const f = state.held;
    let zone;
    let mult;
    if (state.heldCook < 0.3) {
      zone = "生的";
      mult = 0.5;
    } else if (state.heldCook <= 0.8) {
      zone = "正好";
      mult = 1.7;
    } else {
      zone = "糊了";
      mult = 0.15;
    }
    const eatMult = state.abilities.eat ? 1.5 : 1;
    const gain = Math.round(TUNE.baseFansPerDish * mult * eatMult);
    state.fans += gain;
    state.eaten++;
    if (f.pbody) {
      world.removeBody(f.pbody);
      f.pbody = null;
    }
    if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    const idx = foods.indexOf(f);
    if (idx >= 0) foods.splice(idx, 1);
    state.held = null;
    state.heldCook = 0;
    showEvent("吃掉" + zone + "的" + f.type.name + " · 粉丝 +" + gain, 1400);
    showDanmaku("主播吃了" + zone + "的" + f.type.name + "！");
  }

  function tryCut(dt) {
    if (state.tool !== "knife") return;
    if (!focus || focus.kind !== "box" || focus.opened) {
      cutting = null;
      return;
    }
    if (cutting !== focus) cutting = focus;
    cutting.cut += dt / TUNE.cutTime;
    hands.knife.rotation.z = 0.25 + Math.sin(state.time * 32) * 0.16;
    if (cutting.cut >= 1) {
      openBox(cutting);
      cutting = null;
    }
  }

  function openBox(box) {
    box.opened = true;
    // 箱盖翻开：绕后缘旋转，位置以箱子中心为基准
    box.lid.rotation.x = -1.55;
    box.lid.position.set(0, box.size.y / 2 + 0.02, -box.size.z / 2);
    // 食材从箱口偏一点抛出来，并带水平初速度，让它真的掉出来而不是钉在箱顶
    const off = new THREE.Vector3(rand(-0.16, 0.16), box.size.y / 2 + 0.14, rand(-0.16, 0.16));
    const food = spawnFood(box.group.position.clone().add(off), Math.floor(Math.random() * FOOD_TYPES.length));
    if (food.pbody) {
      food.pbody.velocity.set(rand(-0.9, 0.9), rand(0.1, 0.5), rand(-0.9, 0.9));
      food.pbody.angularVelocity.set(rand(-4, 4), rand(-4, 4), rand(-4, 4));
    }
    showEvent("开箱成功！" + food.type.name, 900);
    showDanmaku("拆箱！是" + food.type.name);
  }

  function useTool() {
    if (state.tool === "lighter") {
      lighterFlame.visible = true;
      setTimeout(() => { lighterFlame.visible = false; }, 320);
      if (!focus) return;
      if (focus.kind === "box" && !focus.isBurning) {
        startBurning(focus);
      } else if (focus.kind === "furniture" && !focus.burn) {
        showEvent("家具点不着，只能烧纸箱", 900);
      }
    } else if (state.tool === "bucket") {
      splashWater();
    } else if (state.tool === "broom") {
      sweepAsh();
    }
  }

  function splashWater() {
    if (state.water <= 0) {
      showEvent("水桶是空的，去水槽接水", 900);
      return;
    }
    state.water--;
    // 泼水落点：玩家前方 1.8 米、腰高。直接由玩家状态推算，不依赖渲染时序
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const origin = new THREE.Vector3(player.pos.x, 1.2, player.pos.z).addScaledVector(fwd, 1.8);
    let count = 0;
    for (const item of fires.slice()) {
      const c = fireCenter(item, new THREE.Vector3());
      if (c.distanceTo(origin) < TUNE.waterRadius + (item.burn.radius || 0) * 0.35) {
        if (item.kind === "floor") stopFloorFire(item);
        else stopBurning(item);
        count++;
      }
    }
    const splash = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.55 })
    );
    splash.position.copy(origin);
    scene.add(splash);
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 380;
      if (k >= 1) { scene.remove(splash); return; }
      splash.scale.setScalar(0.5 + k * 2.2);
      splash.material.opacity = 0.55 * (1 - k);
      requestAnimationFrame(anim);
    };
    anim();
    if (count) showEvent("灭了 " + count + " 处火", 900);
  }

  function tryFillWater(dt) {
    if (!focus || focus.kind !== "furniture" || !focus.isSink) {
      filling = 0;
      return;
    }
    const cap = state.abilities.water2 ? 2 : 1;
    if (state.water >= cap) return;
    filling += dt;
    if (filling >= TUNE.fillTime) {
      state.water = cap;
      filling = 0;
      showEvent("水桶装满了", 700);
    }
  }

  function toggleCarry() {
    // 放下：切回动态刚体，位置取玩家身前的地面
    if (state.carried) {
      const b = state.carried;
      const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const lim = ROOM.half - 0.7;
      const px = clamp(player.pos.x + fwd.x * 1.15, -lim, lim);
      const pz = clamp(player.pos.z + fwd.z * 1.15, -lim, lim);
      // 落点要落在"表面"上：如果前面是桌子，就放在桌面上，而不是塞进桌子里
      const surface = supportHeightAt(px, pz, 1.2);
      const dropY = surface + b.size.y / 2 + 0.05;
      b.group.position.set(px, dropY, pz);
      b.group.rotation.set(0, 0, 0);
      b.y = dropY;
      b.vel.set(0, 0, 0);
      b.collider.x = px;
      b.collider.z = pz;
      if (b.pbody) {
        b.pbody.type = CANNON.Body.DYNAMIC;
        b.pbody.position.set(px, dropY, pz);
        b.pbody.quaternion.setFromEuler(0, 0, 0);
        b.pbody.velocity.set(0, 0, 0);
        b.pbody.angularVelocity.set(0, 0, 0);
        b.pbody.wakeUp();
      }
      state.carried = null;
      showEvent("放下了箱子", 700);
      return;
    }

    // 搬起最近的箱子
    let best = null;
    let bestD = 2.4;
    for (const b of boxes) {
      const d = Math.hypot(b.group.position.x - player.pos.x, b.group.position.z - player.pos.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) {
      showEvent("附近没有箱子可搬", 800);
      return;
    }
    state.carried = best;
    if (best.pbody) {
      // 切成运动学刚体：跟着玩家走，但仍会推开别的箱子
      best.pbody.type = CANNON.Body.KINEMATIC;
      best.pbody.velocity.set(0, 0, 0);
      best.pbody.angularVelocity.set(0, 0, 0);
      best.pbody.wakeUp();
    }
    showEvent(best.burn ? "搬起了燃烧的箱子！烫手" : "搬起了箱子 · G 放下", 1200);
  }

  function kick() {
    if (!state.abilities.leg) {
      showEvent("现在还没这个力气（粉丝 250 解锁腿力）", 1000);
      return;
    }
    if (state.legCooldown > 0) return;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    dir.y = 0;
    dir.normalize();
    let target = null;
    let bestD = 2.4;
    for (const b of boxes) {
      const d = Math.hypot(b.group.position.x - player.pos.x, b.group.position.z - player.pos.z);
      if (d < bestD) {
        bestD = d;
        target = b;
      }
    }
    if (target && target.pbody) {
      const p = target.pbody;
      const desiredSpeed = 7.5 / target.weight;     // 想给的速度
      p.wakeUp();
      p.type = CANNON.Body.DYNAMIC;
      // 作用点偏下 → 产生翻倒力矩，箱子会翻滚着飞出去
      p.applyImpulse(
        new CANNON.Vec3(dir.x * desiredSpeed * p.mass, 1.9 * p.mass, dir.z * desiredSpeed * p.mass),
        new CANNON.Vec3(0, -target.size.y * 0.3, 0)
      );
      state.legCooldown = 0.45;
      showEvent("踹！", 500);
    }
  }

  /* ==================== 火势 / 热度 / 事件 ==================== */
  const _tmpVec = new THREE.Vector3();
  // 一处火的世界坐标中心（用于蔓延判定、泼水判定、灼烧判定）
  function fireCenter(item, out) {
    const f = item.burn;
    const v = out || new THREE.Vector3();
    if (f.isFloor) return v.set(item.x, 0.35, item.z);
    const g = f.rig.group.position;
    return v.set(g.x, g.y + f.height * 0.5, g.z);
  }

  function updateFire(dt) {
    /* ---------- 火焰推进：层级、帧动画、半径 ---------- */
    for (const item of fires.slice()) {
      const f = item.burn;
      if (!f) continue;
      f.flicker += dt * 9;

      // 像素帧动画（约 9 fps）
      f.frameT += dt;
      if (f.frameT >= 0.11) {
        f.frameT = 0;
        f.frame = (f.frame + 1) % texPixelFire.length;
        const tex = texPixelFire[f.frame];
        f.rig.group.traverse((o) => { if (o.isMesh) o.material.map = tex; });
      }

      if (f.isFloor) {
        // 地面火：自然熄灭
        f.life -= dt;
        const k = clamp(f.life / TUNE.floorFireTime, 0, 1);
        f.rig.group.scale.setScalar(0.75 + k * 0.45);
        if (f.life <= 0) { stopFloorFire(item); continue; }
      } else if (item.kind === "box") {
        // 箱子：顶部 → 四周 → 整体，逐层扩大
        const st = f.carbon < 0.3 ? 0 : f.carbon < 0.65 ? 1 : 2;
        f.stage = st;
        f.rig.top.visible = true;
        f.rig.sides.visible = st >= 1;
        f.rig.big.visible = st >= 2;
        const half = Math.max(item.size.x, item.size.z) * 0.5;
        f.radius = half * (1 + st * 0.8) + 0.35;
        // 整体燃烧后开始点燃地板
        const igniteRate = st >= 2 ? TUNE.floorIgnitePerSec : (st >= 1 ? TUNE.floorIgnitePerSec * 0.45 : 0);
        if (igniteRate > 0 && Math.random() < igniteRate * dt) {
          const a = Math.random() * Math.PI * 2;
          const r = half + rand(0.3, 1.1);
          const nx = item.group.position.x + Math.cos(a) * r;
          const nz = item.group.position.z + Math.sin(a) * r;
          if (Math.abs(nx) < ROOM.half - 0.4 && Math.abs(nz) < ROOM.half - 0.4) {
            const ff = spawnFloorFire(nx, nz);
            if (ff) showDanmaku("🔥 火爬上地板了！");
          }
        }
      } else {
        // 家具：始终四面燃烧，随时间缩小
        f.life -= dt;
        const k = clamp(f.life / TUNE.furnBurnTime, 0, 1);
        f.rig.top.visible = true;
        f.rig.sides.visible = k > 0.35;
        f.rig.big.visible = k > 0.65;
        f.radius = Math.max(item.collider.hx, item.collider.hz) * (1.1 + (1 - k) * 0.5) + 0.3;
        if (f.life <= 0) { stopBurning(item, item.label + "的火自己灭了"); continue; }
      }

      // 轻微脉动，避免像素火看起来是静止贴图
      const pulse = 1 + Math.sin(f.flicker * 1.4) * 0.05;
      f.rig.group.scale.setScalar(f.isFloor ? f.rig.group.scale.x : pulse);

      if (f.slot && f.slot.owner === item) {
        f.slot.light.intensity = 1.2 + Math.sin(f.flicker * 1.7) * 0.45;
        const c = fireCenter(item, _tmpVec);
        f.slot.light.position.set(c.x, c.y + 0.45, c.z);
      }
    }

    /* ---------- 蔓延：火焰半径内的箱子/家具会被点着 ---------- */
    for (const item of fires.slice()) {
      const f = item.burn;
      if (!f) continue;
      if (f.stage < 1 && !f.isFloor && item.kind === "box") continue;  // 只烧箱顶时还不会蔓延
      if (Math.random() >= TUNE.spreadChancePerSec * dt * 6) continue;
      const c = fireCenter(item, _tmpVec);
      const cands = [];
      for (const b of boxes) {
        if (b === item || b.burn || b === state.carried) continue;
        if (Math.hypot(b.group.position.x - c.x, b.group.position.z - c.z) < f.radius + 0.35) cands.push(b);
      }
      for (const furn of burnables) {
        if (furn === item || furn.burn || furn.isSink) continue;
        if (Math.hypot(furn.mesh.position.x - c.x, furn.mesh.position.z - c.z) < f.radius + 0.4) cands.push(furn);
      }
      if (cands.length) {
        const target = pick(cands);
        startBurning(target);
        showDanmaku("火蔓延到" + (target.kind === "box" ? "旁边的快递箱" : target.label) + "了！");
      }
    }

    // 热度 / 粉丝 / 赔付
    const fireCount = Math.min(fires.length, TUNE.maxHeatFires);
    if (fireCount > 0) {
      const heatGain = TUNE.heatPerFirePerSec * fireCount;
      state.cumulativeHeat += heatGain * dt;
      state.heat = clamp(state.heat + heatGain * 1.6 * dt, 0, 100);
      const eatMult = state.abilities.eat ? 1.5 : 1;
      state.fans += heatGain * TUNE.fansPerHeat * dt * eatMult;
      state.money -= TUNE.payoutPerFirePerSec * fireCount * dt;
      kitchenLight.intensity = Math.min(2.6, 0.25 + fireCount * 0.5);
    } else {
      state.heat = clamp(state.heat - 5 * dt, 0, 100);
      state.cumulativeHeat = Math.max(0, state.cumulativeHeat - 4 * dt);
      kitchenLight.intensity = damp(kitchenLight.intensity, 0.25, 3, dt);
    }

    // 玩家被灼烧
    let burning = 0;
    for (const item of fires) {
      const c = fireCenter(item, _tmpVec);
      const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
      if (d < TUNE.hurtRadius + (item.burn.radius || 0) * 0.3) burning++;
    }
    if (burning > 0 && state.interrupted <= 0) {
      const dmg = TUNE.fireDamagePerSec * burning * (state.abilities.resist ? 0.5 : 1) * dt;
      state.hp -= dmg;
      state.lastHurt = state.time;
      flashScreen(clamp(0.1 * burning, 0, 0.3));
      // 受击反馈：每 0.45 秒给一次明显提示
      if (state.time - lastHurtFx > 0.45) {
        lastHurtFx = state.time;
        hurtFeedback(TUNE.fireDamagePerSec * burning * 0.45);
      }
    }

    // 呼吸回血：离开火一段时间后慢慢恢复
    if (state.time - state.lastHurt > TUNE.regenDelay && state.hp < 100 && state.interrupted <= 0) {
      state.hp = clamp(state.hp + TUNE.hpRegenPerSec * dt, 0, 100);
    }

    // 烤制：任何一处火都能烤任何食材——手里拿着的，或者丢在地上靠近火的
    // 三段配色：生（本色）→ 熟（金黄焦褐）→ 糊（炭黑）
    const COL_RAW = {};
    const COL_COOK = {};
    const COL_BURN = {};
    for (const t of FOOD_TYPES) {
      COL_RAW[t.name] = new THREE.Color(t.raw);
      COL_COOK[t.name] = new THREE.Color(t.cooked);
      COL_BURN[t.name] = new THREE.Color(t.burnt);
    }
    const paintFood = (f) => {
      const name = f.type.name;
      const c = f.mat.color;
      const k = f.cook;
      if (k <= 0.55) {
        // 生 → 熟：起点故意给到 1.6 倍亮度（贴图会被提亮），熟色压到很深的焦褐
        c.copy(COL_RAW[name]).multiplyScalar(1.55).lerp(COL_COOK[name], Math.pow(clamp(k / 0.55, 0, 1), 0.55));
      } else {
        // 熟 → 糊：一路压到接近全黑
        c.copy(COL_COOK[name]).lerp(COL_BURN[name], Math.pow(clamp((k - 0.55) / 0.3, 0, 1), 0.8));
      }
      // 火候正好时食材泛金色微光；过火后连发光也熄灭
      if (k >= 0.3 && k <= 0.8) {
        const center = 1 - Math.abs(k - 0.55) / 0.25;
        const glow = clamp(center, 0, 1);
        f.mat.emissive.setRGB(0.8, 0.34, 0.06).multiplyScalar(glow);
        f.mat.emissiveIntensity = 0.55 + glow * 0.9;
      } else {
        f.mat.emissive.setRGB(0, 0, 0);
        f.mat.emissiveIntensity = 1;
      }
    };
    // 火焰可视范围 = 烤制范围：火烧得越大，能烤到的地方越远
    const nearAnyFire = (pos) => {
      for (const item of fires) {
        if (!item.burn) continue;
        const c = fireCenter(item, _tmpVec);
        const rad = Math.max(TUNE.cookRadius * 0.75, (item.burn.radius || 0.6) + 0.8);
        if (c.distanceTo(pos) < rad) return true;
      }
      return false;
    };
    const cookStep = TUNE.cookRate * dt;

    if (state.held && nearAnyFire(new THREE.Vector3(player.pos.x, 0.9, player.pos.z))) {
      state.heldCook = clamp(state.heldCook + cookStep, 0, 1.2);
      state.held.cook = state.heldCook;
      paintFood(state.held);
    }

    // 丢在地上的食材也会被附近的火烤熟（不限于它自己那只箱子）
    for (const f of foods) {
      if (f === state.held) continue;
      if (nearAnyFire(f.mesh.position)) {
        f.cook = clamp(f.cook + cookStep, 0, 1.2);
        paintFood(f);
      }
    }

    // 邻居投诉
    if (state.cumulativeHeat > TUNE.complaintHeat && !state.complaintShown) {
      state.complaintShown = true;
      showEvent("邻居开始拍墙了！", 1800);
      showDanmaku("【系统】邻居投诉：已收到 1 起噪音投诉");
    }
    if (state.cumulativeHeat < TUNE.complaintHeat * 0.6) state.complaintShown = false;

    // 消防员破门
    if (state.cumulativeHeat >= TUNE.firefighterHeat && !state.reported) {
      state.reported = true;
      triggerFirefighter();
    }
  }

  /* ---------- 消防车调度 + 水柱 ---------- */
  const truckState = { phase: "idle", t: 0 };
  const TRUCK_PARKED_X = 0;   // 占位，实际用 ROOM.half + 2.6

  function splashEffect(x, y, z) {
    const splash = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.6, depthWrite: false })
    );
    splash.position.set(x, y, z);
    scene.add(splash);
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 420;
      if (k >= 1) { scene.remove(splash); return; }
      splash.scale.setScalar(0.4 + k * 1.8);
      splash.material.opacity = 0.6 * (1 - k);
      requestAnimationFrame(anim);
    };
    anim();
  }

  function updateEmergency(dt) {
    // 警灯闪烁
    if (truckState.phase !== "idle") {
      const flick = Math.abs(Math.sin(state.time * 7));
      beaconLight.intensity = 0.9 + flick * 1.5;
      if (truck.userData.beaconGlow) {
        truck.userData.beaconGlow.material.opacity = 0.25 + flick * 0.55;
      }
    }

    const parkX = ROOM.half + 4.4;   // 停在窗口外一点，能看清整车
    if (truckState.phase === "arriving") {
      truckState.t += dt;
      const k = clamp(truckState.t / 1.3, 0, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      truck.position.x = (ROOM.half + 13) + (parkX - (ROOM.half + 13)) * ease;
      if (k >= 1) {
        truckState.phase = "spraying";
        truckState.t = 0;
        flood.target = 0.55;          // 屋里开始灌水
        // 对当前每处火各喷一条水柱，水到火灭
        const snapshot = fires.slice();
        snapshot.forEach((item, idx) => {
          if (!item.burn) return;
          const c = fireCenter(item, new THREE.Vector3());
          const ty = Math.max(0.35, c.y);
          setTimeout(() => {
            sprayAt(c.x, ty, c.z, () => {
              splashEffect(c.x, 0.25, c.z);
              if (item.kind === "floor") stopFloorFire(item);
              else stopBurning(item);
            });
          }, idx * 120);
        });
      }
    } else if (truckState.phase === "spraying") {
      truckState.t += dt;
      if (truckState.t > 1.8) {
        truckState.phase = "leaving";
        truckState.t = 0;
        flood.target = 0;             // 火灭后水慢慢褪去
      }
    } else if (truckState.phase === "leaving") {
      truckState.t += dt;
      const k = clamp(truckState.t / 1.6, 0, 1);
      truck.position.x = parkX + k * 13;
      if (k >= 1) {
        truckState.phase = "idle";
        beaconLight.intensity = 0;
        for (const item of fires.slice()) {
          const c2 = fireCenter(item, new THREE.Vector3());
          splashEffect(c2.x, 0.25, c2.z);
          if (item.kind === "floor") stopFloorFire(item);
          else stopBurning(item);
        }
      }
    }

    updateSprays(dt);
    updateFlood(dt);
  }

  function triggerFirefighter() {
    state.interrupted = 6.5;
    state.money -= 80;
    const bonus = 200 + Math.round(state.cumulativeHeat * 0.6);
    state.fans += bonus;
    state.cumulativeHeat = 0;
    // 消防车从远处开过来（画面不抖，玩家锁定在原地）
    truck.position.x = ROOM.half + 13;
    truckState.phase = "arriving";
    truckState.t = 0;
    const heatNow = Math.round(state.cumulativeHeatSnapshot || 0);
    showInterruptBanner(
      "消防车破门了",
      "累计热度触发邻居报警 · 消防车正在灌水灭火\n事故标签让粉丝暴涨 +" + bonus + " 粉丝",
      6.5
    );
    showDanmaku("【系统】直播间被强制中断");
    showDanmaku("【热度】事故标签让粉丝暴涨 +" + bonus);
    setTimeout(() => { state.reported = false; }, 9000);
  }

  /* ==================== 观众弹幕（本地模拟联机博弈） ==================== */
  let danmakuTimer = 0;
  let trollCooldown = 0;

  function showDanmaku(text) {
    const d = document.createElement("div");
    d.textContent = text;
    if (text.indexOf("【") >= 0) d.className = "sys";
    else if (text.indexOf("❤") >= 0 || text.indexOf("礼物") >= 0) d.className = "gift";
    ui.danmaku.appendChild(d);
    while (ui.danmaku.children.length > 8) ui.danmaku.removeChild(ui.danmaku.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 9000);
  }

  function updateDanmaku(dt) {
    danmakuTimer -= dt;
    trollCooldown -= dt;
    if (danmakuTimer > 0) return;
    danmakuTimer = rand(2.2, 4.2);
    showDanmaku(pick(DANMAKU));
    if (fires.length === 0 || Math.random() >= 0.22 || trollCooldown > 0) return;

    trollCooldown = 22;
    if (Math.random() < 0.55) {
      const item = pick(fires);
      if (item) {
        item.burn.carbon = Math.max(0, item.burn.carbon - 0.28);
        item.burn.flicker += 2;
        showDanmaku("【观众】大哥给你添柴了 🔥");
      }
    } else if (Math.random() < 0.45) {
      showDanmaku("【观众】有人举报了你");
      state.cumulativeHeat = Math.max(state.cumulativeHeat, TUNE.firefighterHeat);
    } else {
      showDanmaku("【观众】举报不成立，对方被扣分反噬");
      state.money += 25;
    }
  }

  /* ==================== HUD ==================== */
  let flash = 0;
  function flashScreen(v) {
    flash = Math.max(flash, v);
  }

  /* ---------- 受击反馈 ---------- */
  let lastHurtFx = -99;
  function hurtFeedback(dmg) {
    ui.hurtOverlay.classList.remove("hit");
    void ui.hurtOverlay.offsetWidth;
    ui.hurtOverlay.classList.add("hit");
    ui.hurtText.textContent = "烫！-" + Math.max(1, Math.round(dmg));
    ui.hurtText.classList.remove("show");
    void ui.hurtText.offsetWidth;
    ui.hurtText.classList.add("show");
    ui.healthHud.classList.remove("hurt");
    void ui.healthHud.offsetWidth;
    ui.healthHud.classList.add("hurt");
  }

  /* ---------- 直播中断横幅（在屏幕正中说明原因） ---------- */
  let bannerTimer = 0;
  function showInterruptBanner(title, sub, seconds) {
    ui.banner.querySelector(".title").textContent = title;
    ui.bannerSub.textContent = sub;
    ui.banner.classList.add("show");
    bannerTimer = seconds || 6;
    updateBannerCount();
  }
  function updateBannerCount() {
    ui.bannerCount.textContent = bannerTimer > 0 ? "直播恢复倒计时 " + Math.ceil(bannerTimer) + " 秒" : "";
  }
  function hideInterruptBanner() {
    ui.banner.classList.remove("show");
    bannerTimer = 0;
  }

  let eventTimer = 0;
  function showEvent(text, ms) {
    ui.event.textContent = text;
    ui.event.classList.add("show");
    eventTimer = (ms || 1000) / 1000;
  }

  function nextAbility() {
    for (const a of ABILITIES) if (!state.abilities[a.key]) return a;
    return null;
  }

  function checkAbilities() {
    let unlocked = null;
    for (const a of ABILITIES) {
      if (!state.abilities[a.key] && state.fans >= a.at) {
        state.abilities[a.key] = true;
        unlocked = a;
        if (a.key !== "nextHouse") growHouse();
      }
    }
    if (unlocked) {
      showDanmaku("【系统】粉丝达成！解锁「" + unlocked.name + "」");
      if (unlocked.key === "nextHouse") showEvent("本关完成：换房功能开发中", 3000);
      else showEvent("解锁：" + unlocked.name, 1600);
    }

    const rows = ABILITIES.map((a) => {
      const on = state.abilities[a.key];
      return '<div class="' + (on ? "unlocked" : "locked") + '">' + (on ? "✔" : "○") + " " +
        a.name + (on ? "" : "（粉丝 " + a.at + "）") + "</div>";
    }).join("");
    if (rows !== ui.abilities.dataset.last) {
      ui.abilities.dataset.last = rows;
      ui.abilities.innerHTML = rows;
    }
  }

  /* ==================== 房屋扩建 ==================== */
  let upgradeCount = 0;

  // 升级时添置的家具（每个都能被点燃、能站上去）
  function addUpgradeFurniture(n) {
    const H = ROOM.half;
    const spot = [
      [-H + 0.8, -H + 1.6],     // 前左角
      [H - 1.0, -H + 1.2],      // 前右角
      [-H + 1.4, H - 1.4],      // 后左角
    ][n % 3];

    if (n === 0) {
      // 冰箱
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8dee6, roughness: 0.35, metalness: 0.55 });
      const main = new THREE.Mesh(roundedBox(0.78, 1.75, 0.68, 0.06, 3), bodyMat);
      main.position.y = 0.9;
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 0.02), new THREE.MeshStandardMaterial({ color: 0x2b323c }));
      line.position.set(0, 1.05, 0.35);
      const handle = new THREE.Mesh(roundedBox(0.06, 0.5, 0.06, 0.02, 2), new THREE.MeshStandardMaterial({ color: 0x8b939c, metalness: 0.8, roughness: 0.3 }));
      handle.position.set(0.28, 1.45, 0.36);
      g.add(main, line, handle);
      addContactShadow(g, 0.9, 0.8, 0.55);
      addFurniture(g, spot[0], spot[1], 0.39, 0.34, "冰箱", 1.78);
    } else if (n === 1) {
      // 书架（三层，带彩色书脊）
      const g = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ map: texWoodGrain, roughness: 0.55 });
      const side = new THREE.Mesh(roundedBox(1.3, 1.9, 0.04, 0.02, 2), wood);
      side.position.set(0, 0.95, -0.2);
      const shelfGeo = roundedBox(1.24, 0.04, 0.4, 0.015, 2);
      for (const y of [0.05, 0.65, 1.25, 1.85]) {
        const s = new THREE.Mesh(shelfGeo, wood);
        s.position.set(0, y, 0);
        g.add(s);
      }
      g.add(side);
      const R = mulberry(31 + n * 7);
      for (let row = 0; row < 3; row++) {
        let x = -0.55;
        while (x < 0.55) {
          const bw = 0.04 + R() * 0.05;
          const bh = 0.28 + R() * 0.12;
          const book = new THREE.Mesh(
            new THREE.BoxGeometry(bw, bh, 0.3),
            new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(R(), 0.5, 0.45), roughness: 0.7 })
          );
          book.position.set(x + bw / 2, 0.2 + row * 0.6 + bh / 2, 0.02);
          g.add(book);
          x += bw + 0.012;
        }
      }
      addContactShadow(g, 1.35, 0.5, 0.5);
      addFurniture(g, spot[0], spot[1], 0.65, 0.22, "书架", 1.9);
    } else {
      // 绿植 + 地毯
      const g = new THREE.Group();
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.36, 12), new THREE.MeshStandardMaterial({ color: 0xb5643c, roughness: 0.8 }));
      pot.position.y = 0.18;
      g.add(pot);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 10, 8),
          new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.28 + Math.random() * 0.06, 0.45, 0.34), roughness: 0.85 })
        );
        leaf.position.set(Math.cos(i * 1.3) * 0.16, 0.52 + Math.random() * 0.3, Math.sin(i * 1.3) * 0.16);
        leaf.scale.set(1, 0.75, 1);
        g.add(leaf);
      }
      addContactShadow(g, 0.6, 0.6, 0.5);
      addFurniture(g, spot[0], spot[1], 0.26, 0.26, "绿植", 0.9);

      // 地毯（纯装饰，没有碰撞）
      const rug = new THREE.Mesh(
        roundedBox(2.6, 0.02, 1.8, 0.05, 2),
        new THREE.MeshStandardMaterial({ map: texFabric, color: 0x8d6f9e, roughness: 0.95 })
      );
      rug.position.set(0.2, 0.012, -ROOM.half + 1.4);
      rug.receiveShadow = true;
      scene.add(rug);
    }
  }

  function expandHouse() {
    if (upgradeCount >= 3) return;
    const oldHalf = ROOM.half;
    const newHalf = Math.min(8.6, oldHalf + 0.9);
    if (newHalf - oldHalf < 0.2) return;
    const delta = newHalf - oldHalf;
    ROOM.half = newHalf;
    upgradeCount++;

    // 地板 / 天花板：换成更大的几何体（不是拉伸，避免四角开口）
    floor.geometry.dispose();
    floor.geometry = new THREE.BoxGeometry(newHalf * 2, 0.2, newHalf * 2);
    ceil.geometry.dispose();
    ceil.geometry = new THREE.BoxGeometry(newHalf * 2, 0.15, newHalf * 2);
    ceil.position.y = ROOM.wallH;
    const rep = (newHalf * 2) / 2.0;
    floorMat.map.repeat.set(rep, rep);
    floorMat.bumpMap.repeat.set(rep, rep);

    // 地面物理体
    groundBody.shapes.length = 0;
    groundBody.addShape(new CANNON.Box(new CANNON.Vec3(newHalf, 0.1, newHalf)));
    groundBody.position.set(0, -0.1, 0);

    // 四面墙：重建几何 + 推到新位置 + 同步碰撞体与物理体
    for (const w of wallMeshes) {
      const c = w.collider;
      const isX = c.hx > c.hz;
      const geo = isX
        ? new THREE.BoxGeometry(newHalf * 2 + 0.4, ROOM.wallH, 0.3)
        : new THREE.BoxGeometry(0.3, ROOM.wallH, newHalf * 2 + 0.4);
      w.mesh.geometry.dispose();
      w.mesh.geometry = geo;
      c.hx = geo.parameters.width / 2;
      c.hz = geo.parameters.depth / 2;
      if (isX) w.mesh.position.z = (w.mesh.position.z >= 0 ? 1 : -1) * newHalf;
      else w.mesh.position.x = (w.mesh.position.x >= 0 ? 1 : -1) * newHalf;
      w.mesh.position.y = ROOM.wallH / 2;
      w.home.copy(w.mesh.position);
      w.target = null;
      c.x = w.mesh.position.x;
      c.z = w.mesh.position.z;
      if (c.body) {
        c.body.position.set(c.x, ROOM.wallH / 2, c.z);
        c.body.shapes.length = 0;
        c.body.addShape(new CANNON.Box(new CANNON.Vec3(c.hx, ROOM.wallH / 2, c.hz)));
      }
    }

    // 踢脚线重建
    for (const m of skirtMeshes) { scene.remove(m); m.geometry.dispose(); }
    skirtMeshes.length = 0;
    addSkirting(newHalf * 2, 0.06, 0, -newHalf + 0.16);
    addSkirting(newHalf * 2, 0.06, 0, newHalf - 0.16);
    addSkirting(0.06, newHalf * 2, -newHalf + 0.16, 0);
    addSkirting(0.06, newHalf * 2, newHalf - 0.16, 0);

    // 墙上的画（-z 墙）与门/窗（+x 墙）跟着搬
    for (const o of mountedLater) o.position.z -= delta;
    for (const o of wallMounted) o.position.x += delta;
    exteriorGroup.position.x += delta;
    truck.position.x += delta;
    beaconLight.position.x += delta;

    // 灌水水面跟着变大
    floodMesh.geometry.dispose();
    floodMesh.geometry = new THREE.PlaneGeometry(newHalf * 2 - 0.3, newHalf * 2 - 0.3);

    buildWindowWall();
    for (const w of wallMeshes) { if (Math.abs(w.mesh.position.x - ROOM.half) < 0.01) w.mesh.visible = false; }
    addUpgradeFurniture(upgradeCount - 1);
    showDanmaku("【系统】房子扩建了！新家具搬进来了");
  }

  // 兼容旧调用名
  function growHouse() { expandHouse(); }

  function updateHouse(dt) {
    for (const w of wallMeshes) {
      if (!w.target) continue;
      w.mesh.position.lerp(w.target, 1 - Math.exp(-2.5 * dt));
      w.collider.x = w.mesh.position.x;
      w.collider.z = w.mesh.position.z;
      // 墙体物理体跟着一起挪，否则箱子会卡在旧墙上
      if (w.collider.body) {
        w.collider.body.position.set(w.mesh.position.x, w.mesh.position.y, w.mesh.position.z);
      }
    }
    const t = clamp(state.fans / 5000, 0, 1);
    for (const it of burnables) {
      if (it.burn) continue;
      for (let i = 0; i < it.childMeshes.length; i++) {
        const m = it.childMeshes[i];
        const base = it.baseColors[i];
        if (base && m.material && m.material.color) {
          m.material.color.copy(base).lerp(new THREE.Color(0xd9c48f), t);
        }
      }
    }
  }

  let lastFansShown = 0;
  function updateHUD(dt) {
    if (ui.lockHint) {
      const locked = document.pointerLockElement === canvas;
      ui.lockHint.textContent = locked ? "鼠标已锁定 · 按 Esc 或 L 释放" : "鼠标未锁定 · 按 L 或点击画面锁定";
      ui.lockHint.style.color = locked ? "rgba(140,220,255,.75)" : "rgba(255,210,120,.9)";
    }
    const fansNow = Math.floor(state.fans);
    ui.fans.textContent = fansNow;
    // 粉丝数跳动提示
    if (fansNow - lastFansShown >= 3) {
      ui.fans.classList.remove("pop");
      void ui.fans.offsetWidth;
      ui.fans.classList.add("pop");
      clearTimeout(ui.fans._popTimer);
      ui.fans._popTimer = setTimeout(() => ui.fans.classList.remove("pop"), 180);
    }
    lastFansShown = fansNow;
    ui.hp.textContent = Math.max(0, Math.round(state.hp));
    ui.heat.textContent = Math.round(state.heat);
    ui.money.textContent = Math.round(state.money);
    const cap = state.abilities.water2 ? 2 : 1;
    ui.water.textContent = state.water <= 0 ? "空" : state.water + "/" + cap + " 满";

    // 底部血条
    ui.healthFill.style.width = clamp(state.hp, 0, 100) + "%";
    ui.healthHud.classList.toggle("low", state.hp < 32 && state.hp > 0);
    const regenerating = state.time - state.lastHurt > TUNE.regenDelay && state.hp < 100 && state.hp > 0;
    ui.healthHud.classList.toggle("regen", regenerating);

    const nx = nextAbility();
    const fanTarget = nx ? nx.at : 5000;
    let prevAt = 0;
    for (const a of ABILITIES) if (state.fans >= a.at) prevAt = a.at;
    ui.fanBar.style.width = clamp(((state.fans - prevAt) / Math.max(1, fanTarget - prevAt)) * 100, 0, 100) + "%";
    ui.heatBar.style.width = state.heat + "%";

    flash = Math.max(0, flash - dt * 1.3);
    ui.flash.style.opacity = flash;

    if (eventTimer > 0) {
      eventTimer -= dt;
      if (eventTimer <= 0) ui.event.classList.remove("show");
    }

    let prompt = "";
    if (state.interrupted > 0) {
      prompt = "直播中断中……";
    } else if (state.carried) {
      prompt = "搬着箱子 · G 放下" + (state.carried.burn ? " · 它还在烧！" : "");
    } else if (state.held) {
      const zone = state.heldCook < 0.3 ? "生的" : state.heldCook <= 0.8 ? "正好" : "糊了";
      prompt = "手持 " + state.held.type.name + "（" + zone + "）· 靠近火烤 · E 吃掉 · Q 放下";
    } else if (focus) {
      if (focus.kind === "box") {
        if (focus.isBurning) prompt = "烧着了";
        else if (!focus.opened) prompt = state.tool === "knife" ? "按住左键切箱" : "按 1 换成刀来切";
        else prompt = state.tool === "lighter" ? "左键点燃纸箱烤食材" : "按 2 换打火机点火";
      } else if (focus.kind === "food") {
        prompt = "E 拾取食材";
      } else if (focus.isSink) {
        prompt = "E 接水" + (state.water >= cap ? "（已满）" : "");
      } else if (focus.burn) {
        prompt = "这家具在烧 · 用 3 水桶浇灭";
      }
    }
    if (prompt !== ui.prompt.dataset.last) {
      ui.prompt.dataset.last = prompt;
      ui.prompt.textContent = prompt;
      ui.prompt.classList.toggle("show", prompt !== "");
    }
  }

  /* ==================== 输入 ==================== */
  const canvas = renderer.domElement;

  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "shift", "e", "f", "g", "q", "l", "p", "r", "1", "2", "3", "4", " "].indexOf(k) >= 0) e.preventDefault();
    if (k === "shift") keys.shift = true;
    else keys[k] = true;

    if (!state.running) return;
    if (k === " ") {
      if (player.onGround || player.coyote > 0) {
        player.vy = TUNE.jumpSpeed;
        player.onGround = false;
        player.coyote = 0;
      }
      return;
    }
    if (k === "1") setTool("knife");
    if (k === "2") setTool("lighter");
    if (k === "3") setTool("bucket");
    if (k === "4") setTool("broom");
    if (k === "r") restart();
    if (k === "p") applyQuality(qualityIdx + 1);
    if (k === "g") toggleCarry();
    if (k === "q") dropHeld();
    if (k === "l") {
      if (document.pointerLockElement === canvas) releasePointerLock();
      else canvas.requestPointerLock();
    }
    if (k === "e") {
      if (state.held) eatHeld();
      else if (focus && focus.kind === "food") pickFood();
      else if (focus && focus.isSink) tryFillWater(9);
    }
    if (k === "f") kick();
  });

  document.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "shift") keys.shift = false;
    else keys[k] = false;
  });

  document.addEventListener("mousedown", (e) => {
    if (!state.running || e.button !== 0) return;
    mouseDown = true;
    useTool();
  });
  document.addEventListener("mouseup", () => { mouseDown = false; });

  document.addEventListener("mousemove", (e) => {
    if (!state.running || state.interrupted > 0) return;
    if (document.pointerLockElement !== canvas) return;
    player.yaw -= e.movementX * 0.0022;
    player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.2, 1.2);
  });

  canvas.addEventListener("click", () => {
    if (state.running && state.interrupted <= 0 && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  });

  // 失去焦点/切标签页/看别的窗口 → 主动释放鼠标锁定，避免鼠标被"困"在游戏窗口里
  function releasePointerLock() {
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  }
  window.addEventListener("blur", releasePointerLock);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releasePointerLock(); });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== canvas && state.running) {
      // 提示玩家点击恢复
      ui.prompt.dataset.last = "";
    }
  });

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  /* ==================== 主循环 ==================== */
  let last = performance.now();
  let spawnTimer = 2;

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (!state.running) {
      renderer.render(scene, camera);
      return;
    }

    state.time += dt;

    // 消防车/水柱在中断期间也要动（否则水柱会冻在半空）
    updateEmergency(dt);

    if (state.interrupted > 0) {
      // 中断期间：画面静止、镜头不抖、玩家不能移动/转视角
      state.interrupted -= dt;
      bannerTimer = Math.max(0, bannerTimer - dt);
      updateBannerCount();
      if (state.interrupted <= 0) hideInterruptBanner();
      updateHUD(dt);
      renderer.render(scene, camera);
      return;
    }

    if (state.legCooldown > 0) state.legCooldown -= dt;
    if (broomSwingT > 0) {
      broomSwingT = Math.max(0, broomSwingT - dt);
      const k = broomSwingT / 0.36;
      hands.broom.rotation.z = 0.55 - Math.sin(k * Math.PI) * 0.75;
      hands.broom.rotation.x = 0.32 + Math.sin(k * Math.PI) * 0.4;
    } else {
      hands.broom.rotation.z = 0.55;
      hands.broom.rotation.x = 0.32;
    }

    updatePlayer(dt);
    world.step(1 / 60, dt, 4);   // 物理推进：叠放、倾倒、碰撞都在这里算
    updateBoxes(dt);
    updateFocus();
    if (mouseDown) tryCut(dt);
    tryFillWater(dt);
    updateFoods(dt);
    updateFire(dt);
    updateDanmaku(dt);
    checkAbilities();
    updateHouse(dt);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = TUNE.parcelInterval;
      spawnParcel();
    }

    bWater.visible = state.water > 0;

    // 手持食材现在是食材本身的模型（挂在 handGroup 上），这里只做轻微晃动
    if (state.held && state.held.inHand) {
      state.held.mesh.position.y = -0.17 + Math.sin(state.time * 2.6) * 0.008;
      state.held.mesh.rotation.y += dt * 0.5;
    }

    for (const k in hands) {
      const lift = k === "broom" ? 0.2 : 0;   // 扫帚重心高一点，头部才在画面里
      hands[k].position.set(
        HAND_POS.x + Math.sin(state.time * 1.6) * 0.006,
        HAND_POS.y + lift + Math.sin(state.time * 2.1) * 0.008,
        HAND_POS.z
      );
    }

    if (state.hp <= 0 && !state.gameOver) {
      state.gameOver = true;
      state.running = false;
      if (document.exitPointerLock) document.exitPointerLock();
      ui.overlay.classList.remove("hidden");
      ui.overlay.innerHTML =
        '<h1>被<span>烤熟</span>了</h1>' +
        '<p>粉丝 ' + Math.floor(state.fans) + " · 吃了 " + state.eaten + " 份 · 余额 " +
        Math.round(state.money) + "<br>直播事故结束。吃播有风险，点火需谨慎。</p>" +
        '<button id="startBtn">再来一次</button>';
      document.getElementById("startBtn").onclick = restart;
    }

    updateHUD(dt);
    renderer.render(scene, camera);
  }

  /* ==================== 启动 / 重开 ==================== */
  function restart() {
    for (const b of boxes) {
      scene.remove(b.group);
      if (b.pbody) world.removeBody(b.pbody);
      const i = colliders.indexOf(b.collider);
      if (i >= 0) colliders.splice(i, 1);
    }
    boxes.length = 0;
    for (const f of foods) {
      scene.remove(f.mesh);
      if (f.pbody) world.removeBody(f.pbody);
    }
    foods.length = 0;
    for (const a of ashPiles) { scene.remove(a); a.geometry.dispose(); a.material.dispose(); }
    ashPiles.length = 0;
    for (const item of fires.slice()) { if (item.kind === "floor") stopFloorFire(item); else stopBurning(item); }

    state.fans = 0;
    state.heat = 0;
    state.cumulativeHeat = 0;
    state.hp = 100;
    state.money = 300;
    state.water = 0;
    state.held = null;
    state.heldCook = 0;
    state.carried = null;
    state.eaten = 0;
    state.interrupted = 0;
    state.reported = false;
    state.complaintShown = false;
    state.gameOver = false;
    state.legCooldown = 0;
    state.lastHurt = -99;
    state.abilities = {};
    state.time = 0;
    spawnTimer = 1.5;

    player.pos.set(0, TUNE.eyeHeight, 4.2);
    player.yaw = 0;
    player.pitch = 0;
    player.bob = 0;
    player.vy = 0;
    player.feet = 0;
    player.coyote = 0;
    player.onGround = true;

    for (const w of wallMeshes) {
      w.mesh.position.copy(w.home);
      w.collider.x = w.home.x;
      w.collider.z = w.home.z;
      w.target = null;
      if (w.collider.body) w.collider.body.position.set(w.home.x, w.home.y, w.home.z);
    }
    floor.scale.set(1, 1, 1);
    ceil.scale.set(1, 1, 1);

    ui.danmaku.innerHTML = "";
    ui.overlay.classList.add("hidden");
    ui.overlay.innerHTML = "";
    state.running = true;
    setTool("knife");
    checkAbilities();
    showEvent("开播！", 1200);
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  }

  document.getElementById("startBtn").onclick = restart;
  setTool("knife");

  // 调试钩子：自动化测试用，不影响游戏逻辑
  window.__game = {
    TUNE: TUNE,
    world: world,
    CANNON: CANNON,
    state: state,
    player: player,
    camera: camera,
    renderer: renderer,
    applyQuality: applyQuality,
    boxes: boxes,
    foods: foods,
    fires: fires,
    burnables: burnables,
    FOOD_TYPES: FOOD_TYPES,
    spawnParcel: spawnParcel,
    spawnFood: spawnFood,
    openBox: openBox,
    startBurning: startBurning,
    eatHeld: eatHeld,
    splashWater: splashWater,
    kick: kick,
    toggleCarry: toggleCarry,
    setTool: setTool,
    supportHeightAt: supportHeightAt,
    playerCollide: playerCollide,
    colliders: colliders,
    getFocus: function () { return focus; },
    floodLevel: function () { return flood.level; },
    handGroup: function () { return handGroup; },
    scene: function () { return scene; },
    dropHeld: dropHeld,
    ashCount: function () { return ashPiles.length; },
    useTool: useTool,
    broomSwinging: function () { return broomSwingT > 0; },
    spawnAshPile: spawnAshPile,
    burnBoxToAsh: burnBoxToAsh,
    expandHouse: expandHouse,
    roomHalf: function () { return ROOM.half; },
    roomInfo: function () {
      let atEdge = 0, cover = 0;
      for (const w of wallMeshes) {
        const c = w.collider;
        const isX = c.hx > c.hz;
        const edge = isX ? Math.abs(w.mesh.position.z) : Math.abs(w.mesh.position.x);
        if (Math.abs(edge - ROOM.half) < 0.05) atEdge++;
        const span = isX ? c.hx * 2 : c.hz * 2;
        if (span >= ROOM.half * 2) cover++;
      }
      return {
        half: ROOM.half,
        wallsAtEdge: atEdge,
        wallsCover: cover,
        floorSize: floor.geometry.parameters.width,
        furniture: burnables.length,
        skirt: skirtMeshes.length
      };
    },
    truckX: function () { return truck.position.x; },
    truck: truck,
    truckPhase: function () { return truckState.phase; },
    windowWallInfo: function () { return windowWallGroup ? windowWallGroup.children.length : 0; },
  };

  requestAnimationFrame(tick);
})();
