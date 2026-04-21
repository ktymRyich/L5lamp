// L5 Lamp — parametric geometry
//
// PH 2/1 の発想:
//   光源（E17/E26 電球のフィラメント位置）から出た光線が、シェードで反射するとき
//   常に鉛直線と一定角度 β をなすように作ると、グレアを抑えつつ均質な配光が得られる。
//   この条件を満たす曲線は、光源を原点に置いたときの "対数螺旋" (logarithmic spiral)。
//
//     r(φ) = r0 * exp( (φ - φ0) * cot(β) )
//
//   φ は水平からの仰角、r(φ) は光源からシェード内面までの距離。
//   これを z 軸まわりに回転させるとシェードの内面（反射面）になる。
//
// 本実装ではシェードを 3 枚 (top cap / middle / bottom) 重ねる PH2/1 配置とし、
// それぞれに sin 波で半径を変調する:
//
//     R(φ, θ, z) = r(φ) * [ 1 + Aθ * sin(nθ * θ + ψz * z) + Az * sin(ωz * z) ]
//
// - Aθ, Az : 振幅（0〜0.15 推奨）
// - nθ     : 角度方向の波数。L5 モチーフなら 3 を基本とする（太陽-地球-L5 の正三角形）
// - ωz     : 鉛直方向の波数。一筆書きスパイラルプリント前提で決める
// - ψz     : z に対する位相ずらし。ねじれたリブ表現になる

import * as THREE from 'three';

/**
 * 対数螺旋シェードの断面プロファイルを生成する。
 * 返り値は [{r, z}] の配列 (z は下向きを正、後で反転する)。
 */
export function logSpiralProfile({
  phiStart = THREE.MathUtils.degToRad(12),   // 光源から見たシェード上端の仰角
  phiEnd   = THREE.MathUtils.degToRad(78),   // シェード下端の仰角
  beta     = THREE.MathUtils.degToRad(30),   // 反射角 (PH 経験値 ~30°)
  r0       = 1.0,                            // 基準半径 (φ = phiStart のときの距離)
  segments = 96,
} = {}) {
  const cotBeta = 1 / Math.tan(beta);
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const phi = phiStart + (phiEnd - phiStart) * t;
    const r = r0 * Math.exp((phi - phiStart) * cotBeta);
    // 光源を原点にしたときの (水平, 鉛直) 距離
    const rHoriz = r * Math.cos(phi);
    const zVert  = r * Math.sin(phi);   // 光源より下側を正にする
    pts.push({ r: rHoriz, z: zVert });
  }
  return pts;
}

/**
 * プロファイル + sin 波変調で回転体メッシュを生成する。
 * profile: [{r, z}]  (z は下向き正)
 * zFlip  : true で z を反転 (three.js の y-up 座標系に合わせる)
 * zOffset: 合成後の中心オフセット（シェード同士を積み重ねるため）
 */
export function buildModulatedShade(profile, {
  radialSegments = 240,
  Atheta   = 0.03,     // 角度方向 sin 振幅（半径比）
  nTheta   = 60,       // 角度方向 sin 波数
  Az       = 0.015,    // 鉛直方向 sin 振幅
  omegaZ   = 18,       // 鉛直方向 sin 波数 (1/unit)
  psiZ     = 4,        // 角度方向 sin の z 位相係数 (ねじれ)
  zOffset  = 0,
  zFlip    = true,
  thickness = 0,       // >0 なら外側にオフセットして単層壁でなく二層にする（通常 0 = vase mode）
  color = 0xf5f1e8,
  emissive = 0x000000,
} = {}) {
  const axialCount = profile.length;
  const positions = new Float32Array(radialSegments * axialCount * 3);
  const normals   = new Float32Array(radialSegments * axialCount * 3);
  const uvs       = new Float32Array(radialSegments * axialCount * 2);

  const zSign = zFlip ? -1 : 1;

  for (let j = 0; j < axialCount; j++) {
    const { r: rBase, z: zBase } = profile[j];
    const zWorld = zBase * zSign + zOffset;
    for (let i = 0; i < radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const mod =
        1 +
        Atheta * Math.sin(nTheta * theta + psiZ * zBase) +
        Az     * Math.sin(omegaZ * zBase);
      const rMod = rBase * mod + thickness;
      const x = rMod * Math.cos(theta);
      const y = zWorld;
      const z = rMod * Math.sin(theta);
      const idx = (j * radialSegments + i) * 3;
      positions[idx + 0] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
      const uvIdx = (j * radialSegments + i) * 2;
      uvs[uvIdx + 0] = i / radialSegments;
      uvs[uvIdx + 1] = j / (axialCount - 1);
    }
  }

  // インデックス (quad → 2 triangles, theta 方向は wrap する)
  const indices = [];
  for (let j = 0; j < axialCount - 1; j++) {
    for (let i = 0; i < radialSegments; i++) {
      const iNext = (i + 1) % radialSegments;
      const a = j * radialSegments + i;
      const b = j * radialSegments + iNext;
      const c = (j + 1) * radialSegments + i;
      const d = (j + 1) * radialSegments + iNext;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    color,
    emissive,
    emissiveIntensity: 0.15,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
    transmission: 0.35,    // 乳白樹脂の半透過
    thickness: 1.0,
    ior: 1.46,
    attenuationColor: 0xffe8b0,
    attenuationDistance: 2.5,
    clearcoat: 0.05,
  });

  return new THREE.Mesh(geom, mat);
}

/**
 * L5 のラグランジュ幾何に基づいた支持リングとアーム。
 * 太陽(S) - 地球(E) - L5 は正三角形を作る。
 * 本ランプでは支柱を 120° 間隔の 3 本にしてこれを暗示する。
 */
export function buildL5Mount({
  ringRadius = 0.22,
  ringThickness = 0.012,
  ringTube = 0.008,
  armLength = 0.35,
  armRadius = 0.004,
  yTop = 0,
  yBase = -0.35,
  color = 0x2a2a2e,
} = {}) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.4, metalness: 0.7,
  });

  // 上部ソケット支持リング
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, ringTube, 16, 96),
    mat
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = yTop;
  group.add(ring);

  // 120° 間隔の 3 本アーム（L5 = 太陽-地球-L5 の正三角形）
  for (let k = 0; k < 3; k++) {
    const theta = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(armRadius, armRadius, armLength, 12),
      mat
    );
    // 上端をリングに、下端をベースに繋ぐ斜めの支柱
    const x1 = ringRadius * Math.cos(theta);
    const z1 = ringRadius * Math.sin(theta);
    const x2 = 0;
    const z2 = 0;
    const y1 = yTop;
    const y2 = yBase;
    const mid = new THREE.Vector3((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    const dir = new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1);
    const len = dir.length();
    arm.scale.y = len / armLength;
    arm.position.copy(mid);
    arm.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.clone().normalize()
    );
    group.add(arm);
  }

  // ベースプレート (L5 の正三角形を平面に刻印)
  const baseGeom = new THREE.CylinderGeometry(0.14, 0.16, 0.02, 64);
  const base = new THREE.Mesh(baseGeom, mat);
  base.position.y = yBase;
  group.add(base);

  // 太陽-地球-L5 三角形の軽い刻印表現: 細い三角枠
  const triShape = new THREE.Shape();
  const R = 0.11;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
    const x = R * Math.cos(a);
    const y = R * Math.sin(a);
    if (k === 0) triShape.moveTo(x, y);
    else triShape.lineTo(x, y);
  }
  triShape.closePath();
  const triPoints = triShape.getPoints();
  const triGeom = new THREE.BufferGeometry().setFromPoints(
    triPoints.map(p => new THREE.Vector3(p.x, 0.0001, p.y))
  );
  const triMat = new THREE.LineBasicMaterial({ color: 0xf0c060, transparent: true, opacity: 0.7 });
  const triLine = new THREE.LineLoop(triGeom, triMat);
  triLine.position.y = yBase + 0.011;
  group.add(triLine);

  return group;
}

/**
 * ソケット + 電球のモック。発光体として PointLight を内包する。
 */
export function buildSocketAndBulb({
  bulbRadius = 0.035,
  bulbY = 0,
  bulbDown = false,        // true で下向き取り付け
  lightIntensity = 8,
  lightColor = 0xffdba0,
} = {}) {
  const group = new THREE.Group();

  const socketMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1c, roughness: 0.5, metalness: 0.8,
  });
  const socket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.022, 0.05, 24),
    socketMat
  );
  socket.position.y = bulbY + (bulbDown ? 0.035 : -0.035);
  group.add(socket);

  const bulbMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    emissive: lightColor,
    emissiveIntensity: 1.2,
    transmission: 0.9,
    transparent: true,
    opacity: 0.9,
    roughness: 0.1,
    ior: 1.5,
  });
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(bulbRadius, 32, 24),
    bulbMat
  );
  bulb.position.y = bulbY;
  group.add(bulb);

  const light = new THREE.PointLight(lightColor, lightIntensity, 10, 1.6);
  light.position.y = bulbY;
  light.castShadow = false;
  group.add(light);
  group.userData.light = light;
  group.userData.bulb = bulb;
  group.userData.socket = socket;

  return group;
}

/**
 * PH2/1 スタイル 3 段シェード + L5 マウント + 電球 を一括で組み上げる。
 * 返り値は THREE.Group。
 * 各メッシュ/パラメータへのアクセスは group.userData 経由で可能。
 */
export function buildLamp(params) {
  const {
    // グローバルスケール（完成品の最大直径 [mm] / 2 / 1000 → m）
    overallScale = 1.0,

    // 反射角 (共通)
    betaDeg = 30,

    // --- 上段シェード (cap) ---
    cap_phiStartDeg = 8,
    cap_phiEndDeg   = 60,
    cap_r0          = 0.25,
    cap_yOffset     = 0.22,

    // --- 中段シェード (main) ---
    mid_phiStartDeg = 12,
    mid_phiEndDeg   = 72,
    mid_r0          = 0.18,
    mid_yOffset     = 0.05,

    // --- 下段シェード (lower) ---
    low_phiStartDeg = 14,
    low_phiEndDeg   = 80,
    low_r0          = 0.11,
    low_yOffset     = -0.08,

    // 共通 sin 波
    Atheta   = 0.03,
    nTheta   = 3,       // L5 モチーフ: 3 を基本に、倍数(6,12,30)で微細化
    nThetaMultiplier = 20,  // 見た目のリブ密度
    Az       = 0.015,
    omegaZ   = 20,
    psiZ     = 4,

    // L5 マウント
    showMount = true,

    // 電球
    bulbDown = false,
    lightIntensity = 8,
  } = params;

  const group = new THREE.Group();
  const shades = {};

  const makeShade = (opts, y) => {
    const prof = logSpiralProfile({
      phiStart: THREE.MathUtils.degToRad(opts.phiStartDeg),
      phiEnd:   THREE.MathUtils.degToRad(opts.phiEndDeg),
      beta:     THREE.MathUtils.degToRad(betaDeg),
      r0:       opts.r0,
    });
    const mesh = buildModulatedShade(prof, {
      Atheta,
      nTheta: nTheta * nThetaMultiplier,
      Az,
      omegaZ,
      psiZ,
      zOffset: y,
      zFlip: true,
    });
    return mesh;
  };

  shades.cap = makeShade({
    phiStartDeg: cap_phiStartDeg, phiEndDeg: cap_phiEndDeg, r0: cap_r0,
  }, cap_yOffset);
  shades.mid = makeShade({
    phiStartDeg: mid_phiStartDeg, phiEndDeg: mid_phiEndDeg, r0: mid_r0,
  }, mid_yOffset);
  shades.low = makeShade({
    phiStartDeg: low_phiStartDeg, phiEndDeg: low_phiEndDeg, r0: low_r0,
  }, low_yOffset);

  group.add(shades.cap, shades.mid, shades.low);

  if (showMount) {
    const mount = buildL5Mount({
      yTop: cap_yOffset + 0.05,
      yBase: -0.42,
    });
    group.add(mount);
    group.userData.mount = mount;
  }

  const bulbGroup = buildSocketAndBulb({
    bulbY: 0,
    bulbDown,
    lightIntensity,
  });
  group.add(bulbGroup);
  group.userData.bulb = bulbGroup;
  group.userData.shades = shades;

  group.scale.setScalar(overallScale);

  return group;
}
