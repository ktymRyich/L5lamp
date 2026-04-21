import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import GUI from 'lil-gui';

import { buildLamp } from './lamp.js';

const params = {
  overallScale: 1.0,
  betaDeg: 30,

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

  Atheta: 0.025,
  nTheta: 3,
  nThetaMultiplier: 20,
  Az: 0.012,
  omegaZ: 22,
  psiZ: 3,

  showMount: true,
  bulbDown: false,
  lightIntensity: 9,
  lightOn: true,
  wireframe: false,

  preset: 'L5 default',
  exportSTL: () => exportSTL(),
  exportSingleShade: () => exportSingleShade(),
};

const presets = {
  'L5 default': {},
  'PH2/1 classic': {
    Atheta: 0.008, Az: 0.004, nThetaMultiplier: 0, omegaZ: 0,
    cap_phiEndDeg: 55, mid_phiEndDeg: 70, low_phiEndDeg: 78,
  },
  'Sine ridges (z)': {
    Atheta: 0.006, Az: 0.03, nThetaMultiplier: 0, omegaZ: 48,
  },
  'Sine ribs (theta)': {
    Atheta: 0.05, Az: 0.005, nThetaMultiplier: 40, omegaZ: 0,
  },
  'Interference (both)': {
    Atheta: 0.04, Az: 0.025, nThetaMultiplier: 24, omegaZ: 30, psiZ: 6,
  },
  'L5 tri-weave (n=3)': {
    Atheta: 0.05, Az: 0.02, nTheta: 3, nThetaMultiplier: 1, omegaZ: 18, psiZ: 12,
  },
};

// ---- Scene ----
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

// Ambient fill
const hemi = new THREE.HemisphereLight(0x8899aa, 0x1a1a22, 0.25);
scene.add(hemi);

// Floor
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3, 64),
  new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.9, metalness: 0 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.45;
scene.add(floor);

let lamp = null;

function rebuild() {
  if (lamp) {
    scene.remove(lamp);
    lamp.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }
  lamp = buildLamp(params);
  lamp.traverse(o => {
    if (o.isMesh && o.material) {
      o.material.wireframe = params.wireframe;
    }
  });
  const light = lamp.userData.bulb?.userData?.light;
  if (light) light.visible = params.lightOn;
  scene.add(lamp);
}
rebuild();

// ---- GUI ----
const gui = new GUI({ title: 'L5 LAMP' });

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

const fSin = gui.addFolder('Sin-wave modulation');
fSin.add(params, 'Atheta', 0, 0.12, 0.002).name('Aθ (radial)').onChange(rebuild);
fSin.add(params, 'nTheta', 1, 8, 1).name('nθ (L5 base)').onChange(rebuild);
fSin.add(params, 'nThetaMultiplier', 0, 60, 1).name('nθ × mult').onChange(rebuild);
fSin.add(params, 'Az', 0, 0.08, 0.002).name('Az (axial)').onChange(rebuild);
fSin.add(params, 'omegaZ', 0, 80, 0.5).name('ωz').onChange(rebuild);
fSin.add(params, 'psiZ', 0, 20, 0.5).name('ψz (twist)').onChange(rebuild);

const fLamp = gui.addFolder('Lamp / Light');
fLamp.add(params, 'showMount').onChange(rebuild);
fLamp.add(params, 'bulbDown').name('bulb ↓').onChange(rebuild);
fLamp.add(params, 'lightIntensity', 0, 30, 0.1).onChange(rebuild);
fLamp.add(params, 'lightOn').onChange(v => {
  const l = lamp.userData.bulb?.userData?.light;
  if (l) l.visible = v;
});
fLamp.add(params, 'wireframe').onChange(v => {
  lamp.traverse(o => { if (o.isMesh && o.material) o.material.wireframe = v; });
});

const fPreset = gui.addFolder('Presets');
fPreset.add(params, 'preset', Object.keys(presets)).onChange(name => {
  Object.assign(params, presets[name]);
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  rebuild();
});

const fExport = gui.addFolder('Export');
fExport.add(params, 'exportSTL').name('Export STL (full)');
fExport.add(params, 'exportSingleShade').name('Export STL (middle only)');

// ---- Export ----
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
  const out = new THREE.Group();
  lamp.userData.shades && Object.values(lamp.userData.shades).forEach(m => out.add(m.clone()));
  const result = exporter.parse(out, { binary: true });
  downloadBlob(new Blob([result], { type: 'application/octet-stream' }), 'l5lamp_shades.stl');
}
function exportSingleShade() {
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

// ---- Hotkeys ----
window.addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') {
    params.lightOn = !params.lightOn;
    const l = lamp.userData.bulb?.userData?.light;
    if (l) l.visible = params.lightOn;
    gui.controllersRecursive().forEach(c => c.updateDisplay());
  }
  if (e.key === 'w' || e.key === 'W') {
    params.wireframe = !params.wireframe;
    lamp.traverse(o => { if (o.isMesh && o.material) o.material.wireframe = params.wireframe; });
    gui.controllersRecursive().forEach(c => c.updateDisplay());
  }
});

// ---- Resize ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Render loop ----
function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
