// L5 Lamp — spiral-vase G-code generator with PATH-LEVEL sine modulation.
//
// 重要 : このモジュールは「STL → スライサ」のパイプラインを通さず、
//         パラメトリック数式から **直接 G-code を書き出す**。
//         理由: vase mode のスライサが補間する都合で、
//               STL 上の sin 波（≒surface modulation）はノズルパスに反映される段階で
//               必ず三角化エイリアスを受ける。
//               ここでは G-code の (x, y, z, e) 各点に直接 sin を載せるので、
//               波形が崩れない。
//
// パス変調モデル (層 j, 周内媒介 t∈[0,1)):
//
//   theta = 2π * t
//   z_layer  = z0 + (j + t) * layerHeight                // spiral vase: 連続 z
//   z_wiggle = Az_path * sin(omegaZ_path * z_layer + nWobble * theta)
//   z_path   = z_layer + z_wiggle                         // ←ノズルが上下にうねる
//   r_nominal= profile(z_layer)                           // 対数螺旋プロファイル
//   r_path   = r_nominal + Apath * sin(nPath * theta + psiZ * z_layer)
//   x = r_path * cos(theta)
//   y = r_path * sin(theta)
//
// 押出量 E は連続 (M82 absolute) で、
//   ΔE = (lineWidth * layerHeight * dist3D) / (π * (Df/2)²)

import * as THREE from 'three';

const TAU = Math.PI * 2;

export function shadeProfileMM({
  phiStartDeg = 12,
  phiEndDeg   = 78,
  betaDeg     = 30,
  r0_mm       = 100,
  yOffset_mm  = 0,
  segments    = 200,
  zFlip       = true,
} = {}) {
  const phi0 = THREE.MathUtils.degToRad(phiStartDeg);
  const phi1 = THREE.MathUtils.degToRad(phiEndDeg);
  const beta = THREE.MathUtils.degToRad(betaDeg);
  const cot  = 1 / Math.tan(beta);
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const phi = phi0 + (phi1 - phi0) * t;
    const r = r0_mm * Math.exp((phi - phi0) * cot);
    const rH = r * Math.cos(phi);
    const zV = r * Math.sin(phi) * (zFlip ? -1 : 1) + yOffset_mm;
    pts.push({ r: rH, z: zV });
  }
  return pts;
}

function profileAsZAscending(profile) {
  const arr = profile.map(p => ({ z: p.z, r: p.r }));
  arr.sort((a, b) => a.z - b.z);
  return arr;
}

function interpRadius(profileZAsc, z) {
  if (z <= profileZAsc[0].z) return profileZAsc[0].r;
  const last = profileZAsc[profileZAsc.length - 1];
  if (z >= last.z) return last.r;
  let lo = 0, hi = profileZAsc.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profileZAsc[mid].z <= z) lo = mid; else hi = mid;
  }
  const a = profileZAsc[lo], b = profileZAsc[hi];
  const t = (z - a.z) / (b.z - a.z);
  return a.r + (b.r - a.r) * t;
}

/**
 * 1 シェード分のパス点列を生成する。
 * 戻り値: { points: Float32Array of [x,y,z,e]*N, samples, layerCount, totalE }
 */
export function generateShadePath({
  profile,
  layerHeight = 0.2,
  samplesPerLayer = 240,
  Apath = 0.5,
  nPath = 60,
  psiZ  = 0.2,
  Az_path = 0.3,
  omegaZ_path = 0.4,
  nWobble = 6,
  filamentDiameter = 1.75,
  lineWidth = 0.5,
  z0 = 0.3,
  cx = 0,
  cy = 0,
} = {}) {
  const profAsc = profileAsZAscending(profile);
  const zMin = profAsc[0].z;
  const zMax = profAsc[profAsc.length - 1].z;
  const layerCount = Math.max(1, Math.floor((zMax - zMin) / layerHeight));
  const samples = samplesPerLayer;
  const totalSamples = layerCount * samples;

  const filArea = Math.PI * (filamentDiameter / 2) ** 2;
  const eFactor = (lineWidth * layerHeight) / filArea;

  const buf = new Float32Array(totalSamples * 4);
  let prevX = null, prevY = null, prevZ = null;
  let E = 0;

  for (let j = 0; j < layerCount; j++) {
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      const theta = TAU * t;
      const zLayer = z0 + (j + t) * layerHeight + zMin;
      const zModel = zMin + (j + t) * layerHeight;
      const zWiggle = Az_path * Math.sin(omegaZ_path * zModel + nWobble * theta);
      const zPath = zLayer + zWiggle;

      const rNom = interpRadius(profAsc, zModel);
      const rPath = rNom + Apath * Math.sin(nPath * theta + psiZ * zModel);

      const x = cx + rPath * Math.cos(theta);
      const y = cy + rPath * Math.sin(theta);
      const z = zPath;

      if (prevX !== null) {
        const dx = x - prevX, dy = y - prevY, dz = z - prevZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        E += dist * eFactor;
      }
      const idx = (j * samples + i) * 4;
      buf[idx + 0] = x;
      buf[idx + 1] = y;
      buf[idx + 2] = z;
      buf[idx + 3] = E;
      prevX = x; prevY = y; prevZ = z;
    }
  }

  return { points: buf, samples, layerCount, totalE: E };
}

/**
 * 複数シェードのパスを連結し、シェード間は travel + retract で繋ぐ G-code を生成する。
 */
export function generateGcode({
  shades,
  bedSizeX = 220, bedSizeY = 220,
  centerOnBed = true,
  hotendTempC = 215,
  bedTempC = 60,
  printSpeed = 1500,
  travelSpeed = 6000,
  firstLayerSpeed = 600,
  retractDist = 1.0,
  retractSpeed = 2400,
  z0 = 0.3,
  filamentDiameter = 1.75,
  lineWidth = 0.5,
  layerHeight = 0.2,
} = {}) {
  const lines = [];
  const cx = centerOnBed ? bedSizeX / 2 : 0;
  const cy = centerOnBed ? bedSizeY / 2 : 0;

  lines.push('; L5 Lamp — generated G-code (path-level sine modulation)');
  lines.push(`; bed=${bedSizeX}x${bedSizeY} hotend=${hotendTempC}C bed=${bedTempC}C`);
  lines.push(`; LH=${layerHeight} LW=${lineWidth} filament=${filamentDiameter}`);
  lines.push('M82 ; absolute extrusion');
  lines.push('G21 ; mm');
  lines.push('G90 ; absolute pos');
  lines.push(`M140 S${bedTempC}`);
  lines.push(`M104 S${hotendTempC}`);
  lines.push('G28 ; home');
  lines.push(`M190 S${bedTempC}`);
  lines.push(`M109 S${hotendTempC}`);
  lines.push('G92 E0');
  lines.push(`G1 Z5 F${travelSpeed}`);

  // priming line
  lines.push(`G1 X10 Y10 Z0.3 F${travelSpeed}`);
  lines.push(`G1 X${(bedSizeX - 10).toFixed(1)} Y10 Z0.3 E20 F${firstLayerSpeed}`);
  lines.push('G92 E0');

  let totalE = 0;
  let firstShade = true;

  for (const sh of shades) {
    const { profile, params } = sh;
    const path = generateShadePath({
      ...params,
      profile,
      filamentDiameter,
      lineWidth,
      layerHeight,
      z0,
      cx,
      cy,
    });

    const x0 = path.points[0];
    const y0 = path.points[1];
    const z0p = path.points[2];
    if (!firstShade) {
      lines.push(`G1 E${(totalE - retractDist).toFixed(4)} F${retractSpeed} ; retract`);
    }
    lines.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} Z${(z0p + 1.0).toFixed(3)} F${travelSpeed}`);
    lines.push(`G1 Z${z0p.toFixed(3)} F${travelSpeed}`);
    if (!firstShade) {
      lines.push(`G1 E${totalE.toFixed(4)} F${retractSpeed} ; unretract`);
    }
    firstShade = false;

    const N = path.points.length / 4;
    for (let i = 0; i < N; i++) {
      const idx = i * 4;
      const x = path.points[idx + 0];
      const y = path.points[idx + 1];
      const z = path.points[idx + 2];
      const e = path.points[idx + 3] + totalE;
      const speed = i < params.samplesPerLayer ? firstLayerSpeed : printSpeed;
      lines.push(
        `G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)} E${e.toFixed(4)} F${speed}`
      );
    }
    totalE += path.totalE;
  }

  lines.push(`G1 E${(totalE - retractDist).toFixed(4)} F${retractSpeed} ; final retract`);
  lines.push(`G1 Z${(z0 + 50).toFixed(2)} F${travelSpeed}`);
  lines.push('M104 S0');
  lines.push('M140 S0');
  lines.push('G28 X0');
  lines.push('M84');
  lines.push('; end');

  return {
    gcode: lines.join('\n') + '\n',
    totalE,
  };
}
