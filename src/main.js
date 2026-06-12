import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import GUI from 'lil-gui';

import { buildLamp } from './lamp.js';
import { shadeProfileMM, generateShadePath, generateGcode } from './gcode.js';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------
const params = {
  // 表示モード
  viewMode: 'surface',        // 'surface' | 'toolpath'

  overallScale: 1.0,
  betaDeg: 30,

  // シェード幾何 (three.js プレビュー単位: m。G-code 出力時は ×1000 → mm)
  cap_phiStartDeg: 8,
  cap_phiEndDeg:   58,
  cap_r0:          0.22,
  cap_yOffset:     0.24,

  mid_phiStartDeg: 14,
  mid_phiEndDeg:   72,
  mid_r0:          0.17,
  mid_yOffset:     0.06,

  low_phiStartDeg: 16,
  low_phiEndDeg:   80,
  low_r0:          0.10,
  low_yOffset:     -0.10,

  // surface 用 sin (見た目プレビュー)
  Atheta: 0.025,
  nTheta: 3,
  nThetaMultiplier: 20,
  Az: 0.012,
  omegaZ: 22,
  psiZ: 3,

  // ---- PATH-level sine (Gcode 直書き用) ----
  // 「線そのものが波打つ」プリント技法のためのパラメータ。
  path_Apath_mm:    0.5,     // 半径方向 sin 振幅 [mm]
  path_nPath:       60,      // 周方向 sin 波数
  path_psiZ:        0.2,     // 角度 sin の z 位相係数 [rad/mm]
  path_Az_mm:       0.35,    // ★Z 方向うねり [mm] — 線そのものが上下に揺れる
  path_omegaZ:      0.5,     // Z うねり周波数 [rad/mm]
  path_nWobble:     6,       // Z うねりに乗せる angular 成分

  path_layerHeight: 0.2,     // [mm]
  path_lineWidth:   0.5,     // [mm]
  path_samplesPerLayer: 240,
  path_filamentDia: 1.75,

  // プリンタ
  printer_bedX:     220,
  printer_bedY:     220,
  printer_hotendC:  215,
  printer_bedC:     60,
  printer_printSpd: 1500,    // [mm/min]
  printer_travelSpd: 6000,
  printer_z0:       0.3,

  // ランプ
  showMount: true,
  bulbDown: false,
  lightIntensity: 9,
  lightOn: true,
  wireframe: false,

  preset: 'L5 default',
  exportSTL: () => exportSTL(),
  exportSingleShade: () => exportSingleShade(),
  exportGcode: () => exportGcode(),
};

const presets = {
  'L5 default': {},
  'PH2/1 classic': {
    Atheta: 0.008, Az: 0.004, nThetaMultiplier: 0, omegaZ: 0,
    cap_phiEndDeg: 55, mid_phiEndDeg: 70, low_phiEndDeg: 78,
    path_Apath_mm: 0.2, path_Az_mm: 0.05, path_nPath: 80,
  },
  'Sine ridges (z)': {
    Atheta: 0.006, Az: 0.03, nThetaMultiplier: 0, omegaZ: 48,
    path_Apath_mm: 0.05, path_Az_mm: 0.6, path_omegaZ: 1.2, path_nWobble: 0,
  },
  'Sine ribs (theta)': {
    Atheta: 0.05, Az: 0.005, nThetaMultiplier: 40, omegaZ: 0,
    path_Apath_mm: 0.8, path_nPath: 80, path_Az_mm: 0.05,
  },
  'Interference (both)': {
    Atheta: 0.04, Az: 0.025, nThetaMultiplier: 24, omegaZ: 30, psiZ: 6,
    path_Apath_mm: 0.5, path_nPath: 48, path_Az_mm: 0.4,
    path_omegaZ: 0.8, path_nWobble: 12,
  },
  'L5 tri-weave (n=3)': {
    Atheta: 0.05, Az: 0.02, nTheta: 3, nThetaMultiplier: 1, omegaZ: 18, psiZ: 12,
    path_Apath_mm: 0.7, path_nPath: 3, path_Az_mm: 0.5,
    path_omegaZ: 0.6, path_nWobble: 3,
  },
  'Z-wobble showcase': {
    // パス変調の本命: Z だけ激しくうねらせる
    Atheta: 0.005, Az: 0.005, nThetaMultiplier: 0, omegaZ: 0,
    path_Apath_mm: 0.1, path_nPath: 8,
    path_Az_mm: 1.2, path_omegaZ: 0.8, path_nWobble: 8,
  },
};

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0d);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(1.0, 0.35, 1.3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.3;
controls.maxDistance = 6;

const hemi = new THREE.HemisphereLight(0x8899aa, 0x1a1a22, 0.25);
scene.add(hemi);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3, 64),
  new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.9, metalness: 0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.45;
scene.add(floor);

let lamp = null;          // surface preview
let toolpathGroup = null; // toolpath preview

// ---------------------------------------------------------------------------
// Shade param mapping (preview-space [m] ↔ printer-space [mm])
// プレビューで触っているのは m 単位。Gcode/toolpath は mm に揃える。
// ---------------------------------------------------------------------------
function shadeParamsMM(prefix) {
  return {
    phiStartDeg: params[`${prefix}_phiStartDeg`],
    phiEndDeg:   params[`${prefix}_phiEndDeg`],
    betaDeg:     params.betaDeg,
    r0_mm:       params[`${prefix}_r0`] * 1000 * params.overallScale,
    yOffset_mm:  params[`${prefix}_yOffset`] * 1000 * params.overallScale,
    segments:    160,
    zFlip:       true,
  };
}

function pathParams() {
  return {
    Apath:        params.path_Apath_mm,
    nPath:        params.path_nPath,
    psiZ:         params.path_psiZ,
    Az_path:      params.path_Az_mm,
    omegaZ_path:  params.path_omegaZ,
    nWobble:      params.path_nWobble,
    layerHeight:  params.path_layerHeight,
    samplesPerLayer: params.path_samplesPerLayer,
  };
}

// ---------------------------------------------------------------------------
// Rebuild — surface or toolpath mode
// ---------------------------------------------------------------------------
function disposeGroup(g) {
  if (!g) return;
  scene.remove(g);
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
}

function rebuild() {
  disposeGroup(lamp);
  disposeGroup(toolpathGroup);
  lamp = null;
  toolpathGroup = null;

  if (params.viewMode === 'surface') {
    lamp = buildLamp(params);
    lamp.traverse(o => {
      if (o.isMesh && o.material) o.material.wireframe = params.wireframe;
    });
    const light = lamp.userData.bulb?.userData?.light;
    if (light) light.visible = params.lightOn;
    scene.add(lamp);
  } else {
    // toolpath: Gcode と同じ数式で線を生成し、3D 表示する
    toolpathGroup = buildToolpathPreview();
    scene.add(toolpathGroup);
  }
}

// ---------------------------------------------------------------------------
// Toolpath preview — actual nozzle path as colored line
// ---------------------------------------------------------------------------
function buildToolpathPreview() {
  const group = new THREE.Group();
  // mm 空間で計算 → m に縮めて表示 (1/1000)
  const shadeKeys = ['cap', 'mid', 'low'];
  for (const k of shadeKeys) {
    const profile = shadeProfileMM(shadeParamsMM(k));
    const path = generateShadePath({
      profile,
      ...pathParams(),
      filamentDiameter: params.path_filamentDia,
      lineWidth: params.path_lineWidth,
      z0: 0,           // プレビューでは床合わせしない
      cx: 0, cy: 0,
    });
    const N = path.points.length / 4;
    const positions = new Float32Array(N * 3);
    const colors    = new Float32Array(N * 3);
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      const z = path.points[i * 4 + 2];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const zRange = Math.max(1e-6, maxZ - minZ);
    for (let i = 0; i < N; i++) {
      const idx = i * 4;
      // mm → m, three.js は y-up なので Z(mm) を y にマップ
      positions[i * 3 + 0] =  path.points[idx + 0] / 1000;
      positions[i * 3 + 1] =  path.points[idx + 2] / 1000;
      positions[i * 3 + 2] =  path.points[idx + 1] / 1000;
      // 高さで温度勾配
      const t = (path.points[idx + 2] - minZ) / zRange;
      const c = new THREE.Color().setHSL(0.08 + 0.55 * (1 - t), 0.85, 0.55);
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geom, mat);
    group.add(line);
  }
  // 軽くスケール調整 — surface mode と比例
  group.scale.setScalar(params.overallScale);
  return group;
}

// ---------------------------------------------------------------------------
// G-code export
// ---------------------------------------------------------------------------
function exportGcode() {
  const shades = ['cap', 'mid', 'low'].map(k => ({
    profile: shadeProfileMM(shadeParamsMM(k)),
    params:  pathParams(),
  }));
  const { gcode, totalE } = generateGcode({
    shades,
    bedSizeX: params.printer_bedX,
    bedSizeY: params.printer_bedY,
    hotendTempC: params.printer_hotendC,
    bedTempC: params.printer_bedC,
    printSpeed: params.printer_printSpd,
    travelSpeed: params.printer_travelSpd,
    z0: params.printer_z0,
    layerHeight: params.path_layerHeight,
    lineWidth: params.path_lineWidth,
    filamentDiameter: params.path_filamentDia,
  });
  downloadBlob(
    new Blob([gcode], { type: 'text/plain' }),
    'l5lamp.gcode'
  );
  console.log(`Estimated filament: ${(totalE / 1000).toFixed(2)} m`);
}

// ---------------------------------------------------------------------------
// STL export (surface mode のみ)
// ---------------------------------------------------------------------------
const exporter = new STLExporter();
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`saved: ${filename}`);
}
function exportSTL() {
  if (!lamp || !lamp.userData.shades) {
    toast('switch to "surface" mode first');
    return;
  }
  const out = new THREE.Group();
  Object.values(lamp.userData.shades).forEach(m => out.add(m.clone()));
  const result = exporter.parse(out, { binary: true });
  downloadBlob(new Blob([result], { type: 'application/octet-stream' }), 'l5lamp_shades.stl');
}
function exportSingleShade() {
  if (!lamp || !lamp.userData.shades) {
    toast('switch to "surface" mode first');
    return;
  }
  const mid = lamp.userData.shades?.mid;
  if (!mid) return;
  const result = exporter.parse(mid, { binary: true });
  downloadBlob(new Blob([result], { type: 'application/octet-stream' }), 'l5lamp_shade_middle.stl');
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------------------------------------------------------------------------
// GUI
// ---------------------------------------------------------------------------
const gui = new GUI({ title: 'L5 LAMP' });

const fView = gui.addFolder('View');
fView.add(params, 'viewMode', ['surface', 'toolpath']).name('mode').onChange(rebuild);

const fScale = gui.addFolder('Scale & Reflect angle');
fScale.add(params, 'overallScale', 0.3, 2.0, 0.01).onChange(rebuild);
fScale.add(params, 'betaDeg', 10, 60, 0.5).name('β (reflect°)').onChange(rebuild);

const fCap = gui.addFolder('Shade: CAP (top)').close();
fCap.add(params, 'cap_phiStartDeg', 1, 30, 0.5).onChange(rebuild);
fCap.add(params, 'cap_phiEndDeg',   20, 80, 0.5).onChange(rebuild);
fCap.add(params, 'cap_r0',          0.05, 0.45, 0.005).onChange(rebuild);
fCap.add(params, 'cap_yOffset',    -0.1, 0.5, 0.005).onChange(rebuild);

const fMid = gui.addFolder('Shade: MIDDLE').close();
fMid.add(params, 'mid_phiStartDeg', 1, 30, 0.5).onChange(rebuild);
fMid.add(params, 'mid_phiEndDeg',   20, 85, 0.5).onChange(rebuild);
fMid.add(params, 'mid_r0',          0.05, 0.4, 0.005).onChange(rebuild);
fMid.add(params, 'mid_yOffset',    -0.2, 0.4, 0.005).onChange(rebuild);

const fLow = gui.addFolder('Shade: LOWER').close();
fLow.add(params, 'low_phiStartDeg', 1, 30, 0.5).onChange(rebuild);
fLow.add(params, 'low_phiEndDeg',   20, 88, 0.5).onChange(rebuild);
fLow.add(params, 'low_r0',          0.04, 0.3, 0.005).onChange(rebuild);
fLow.add(params, 'low_yOffset',    -0.4, 0.2, 0.005).onChange(rebuild);

const fSin = gui.addFolder('Surface sin (preview)');
fSin.add(params, 'Atheta', 0, 0.12, 0.002).name('Aθ (radial)').onChange(rebuild);
fSin.add(params, 'nTheta', 1, 8, 1).name('nθ (L5 base)').onChange(rebuild);
fSin.add(params, 'nThetaMultiplier', 0, 60, 1).name('nθ × mult').onChange(rebuild);
fSin.add(params, 'Az', 0, 0.08, 0.002).name('Az (axial)').onChange(rebuild);
fSin.add(params, 'omegaZ', 0, 80, 0.5).name('ωz').onChange(rebuild);
fSin.add(params, 'psiZ', 0, 20, 0.5).name('ψz (twist)').onChange(rebuild);

const fPath = gui.addFolder('★ Path sin (G-code)').open();
fPath.add(params, 'path_Apath_mm', 0, 2, 0.01).name('A_path [mm] (radial)').onChange(rebuild);
fPath.add(params, 'path_nPath', 0, 200, 1).name('n_path').onChange(rebuild);
fPath.add(params, 'path_psiZ', 0, 2, 0.01).name('ψz [rad/mm]').onChange(rebuild);
fPath.add(params, 'path_Az_mm', 0, 2, 0.01).name('A_z [mm] (Z wobble) ★').onChange(rebuild);
fPath.add(params, 'path_omegaZ', 0, 5, 0.01).name('ωz [rad/mm]').onChange(rebuild);
fPath.add(params, 'path_nWobble', 0, 30, 1).name('n_wobble (θ on Z)').onChange(rebuild);

const fSlicer = gui.addFolder('Slicer / Print params').close();
fSlicer.add(params, 'path_layerHeight', 0.1, 0.4, 0.02).name('layer height [mm]').onChange(rebuild);
fSlicer.add(params, 'path_lineWidth',   0.3, 0.8, 0.02).name('line width [mm]').onChange(rebuild);
fSlicer.add(params, 'path_samplesPerLayer', 60, 480, 12).name('samples/layer').onChange(rebuild);
fSlicer.add(params, 'path_filamentDia', 1.6, 3.0, 0.05).name('filament Ø');

const fPrinter = gui.addFolder('Printer').close();
fPrinter.add(params, 'printer_bedX', 100, 400, 10).name('bed X');
fPrinter.add(params, 'printer_bedY', 100, 400, 10).name('bed Y');
fPrinter.add(params, 'printer_hotendC', 180, 260, 1).name('hotend °C');
fPrinter.add(params, 'printer_bedC', 0, 110, 1).name('bed °C');
fPrinter.add(params, 'printer_printSpd', 300, 4000, 50).name('print spd mm/min');
fPrinter.add(params, 'printer_travelSpd', 1000, 10000, 100).name('travel spd');
fPrinter.add(params, 'printer_z0', 0.1, 1.0, 0.05).name('z0 [mm]');

const fLamp = gui.addFolder('Lamp / Light');
fLamp.add(params, 'showMount').onChange(rebuild);
fLamp.add(params, 'bulbDown').name('bulb ↓').onChange(rebuild);
fLamp.add(params, 'lightIntensity', 0, 30, 0.1).onChange(rebuild);
fLamp.add(params, 'lightOn').onChange(v => {
  const l = lamp?.userData?.bulb?.userData?.light;
  if (l) l.visible = v;
});
fLamp.add(params, 'wireframe').onChange(v => {
  if (!lamp) return;
  lamp.traverse(o => { if (o.isMesh && o.material) o.material.wireframe = v; });
});

const fPreset = gui.addFolder('Presets');
fPreset.add(params, 'preset', Object.keys(presets)).onChange(name => {
  Object.assign(params, presets[name]);
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  rebuild();
});

const fExport = gui.addFolder('Export').open();
fExport.add(params, 'exportGcode').name('★ Export G-code (.gcode)');
fExport.add(params, 'exportSTL').name('Export STL (full)');
fExport.add(params, 'exportSingleShade').name('Export STL (middle only)');

rebuild();

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') {
    params.lightOn = !params.lightOn;
    const l = lamp?.userData?.bulb?.userData?.light;
    if (l) l.visible = params.lightOn;
    gui.controllersRecursive().forEach(c => c.updateDisplay());
  }
  if (e.key === 'w' || e.key === 'W') {
    params.wireframe = !params.wireframe;
    if (lamp) lamp.traverse(o => { if (o.isMesh && o.material) o.material.wireframe = params.wireframe; });
    gui.controllersRecursive().forEach(c => c.updateDisplay());
  }
  if (e.key === 't' || e.key === 'T') {
    params.viewMode = params.viewMode === 'surface' ? 'toolpath' : 'surface';
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    rebuild();
  }
});

// ---------------------------------------------------------------------------
// Resize / loop
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
