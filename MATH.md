# L5 Lamp — 形状の数式

このドキュメントは、`src/lamp.js` が内部で生成する形状の数学的定義をまとめたもの。  
three.js ビューアのスライダ（`index.html`）と 1:1 で対応する。

## 0. ビューアの起動

```sh
python3 -m http.server 8000
# → http://localhost:8000/
```

- ドラッグ: 回転 / ホイール: ズーム / 右ドラッグ: パン
- `L` : ライト ON/OFF, `W` : ワイヤーフレーム
- 右上 GUI のプリセット: `PH2/1 classic` / `Sine ridges (z)` / `Sine ribs (theta)` / `Interference (both)` / `L5 tri-weave (n=3)`
- `Export` から STL 書き出し（全体 / 中段のみ）

---

## 1. 基礎: 対数螺旋シェード（PH 型）

Poul Henningsen の PH シリーズは「光源から出た任意の光線が、シェードで反射されたあと、鉛直線と常に一定角 β をなす」という条件でシェード断面を決めている。  
この条件を満たす曲線は、光源を原点に置いたときの**対数螺旋**（logarithmic spiral）である。

光源からの距離 r を、水平からの仰角 φ の関数として:

$$
r(\varphi) \;=\; r_0 \, \exp\!\bigl((\varphi - \varphi_0)\cot\beta\bigr)
$$

| 記号 | 意味 | 既定値 |
|------|------|--------|
| r₀   | 仰角 φ₀ のときのシェード距離 | shade ごとに 0.10 – 0.25 [m] |
| φ₀   | シェード上端の仰角 | 8 – 16° |
| φ₁   | シェード下端の仰角 | 58 – 80° |
| β    | 反射角（鉛直線との一定角） | 30° (PH 慣用値) |

断面を (水平方向 ρ, 鉛直方向 h) に展開:

$$
\rho(\varphi) = r(\varphi)\cos\varphi,\quad
h(\varphi) = r(\varphi)\sin\varphi
$$

これを z 軸まわりに回転させた回転体がシェード内面。  
シェードが 3 枚 (cap / middle / lower) 積まれ、電球からの直視ラインを塞ぐ ─ これが「光源が直接目に入らない」の根拠。

> 実装: `logSpiralProfile()` in `src/lamp.js`

---

## 2. sin 波変調（本ランプの意匠）

プレーンな対数螺旋回転体に、**半径方向の比率で 2 種類の sin 波を加算**する。

$$
R(\theta, z) \;=\; \rho(z)\,\Bigl[\,1 \;+\; A_\theta \sin(n_\theta\,\theta + \psi_z\,z) \;+\; A_z \sin(\omega_z\,z)\,\Bigr]
$$

| 記号 | 意味 | 推奨レンジ | 効果 |
|------|------|------------|------|
| Aθ   | 角度方向 sin 振幅（比） | 0 – 0.06 | 縦リブの深さ |
| nθ   | 角度方向 sin 波数 | 1 – 60 | リブ本数（L5 モチーフなら 3 の倍数） |
| ψz   | 角度 sin の z 位相係数 | 0 – 12 | ねじれ（0 = 真っ直ぐ、大きいほど螺旋） |
| Az   | 鉛直方向 sin 振幅（比） | 0 – 0.04 | 横リッジの深さ |
| ωz   | 鉛直方向 sin 波数 [1/m] | 0 – 60 | 横リッジの本数 |

### 光学的な意図
- **Aθ sin(nθ θ)** → 水平方向に光強度を周期変化させる。視線が動くと面が揺らぎ、柔らかさが出る。
- **Az sin(ωz z)**   → 鉛直方向に光強度を周期変化させる。シェードの縞模様。
- **ψz z** の項で両者を位相結合すると、干渉縞のような斜めリブが発生する。

### L5 モチーフの埋め込み

太陽 (S) − 地球 (E) − L5 が作る **正三角形** (60° 等分配) を、角度方向 sin の基本波数 `nθ = 3` で表現する。  
`nθ × multiplier` で整数倍 (6, 12, 30 など) のリブに展開する運用:

$$
n_\theta^{\text{use}} \;=\; 3 \times m,\quad m \in \{1,2,\dots\}
$$

こうすると、どの倍率を選んでも 3 回対称は保たれる。  
ベースプレートには、太陽-地球-L5 の正三角形を実サイズで刻印する（ビューア上は細い線として可視化）。

> 実装: `buildModulatedShade()` / `buildL5Mount()`

---

## 3. 3 段シェードの配置（PH 2/1 型）

本ランプは PH 2/1 と同じ **3 段構成**。各段のパラメータ目安:

| 段 | r₀ [m] | φ start | φ end | y オフセット [m] |
|----|--------|---------|-------|------------------|
| cap (top)    | 0.22 | 8°  | 58° | +0.24 |
| middle       | 0.17 | 14° | 72° | +0.06 |
| lower        | 0.10 | 16° | 80° | −0.10 |

フィラメントは原則 `y = 0`。上向き (bulb up) の場合は cap 内面で反射、下向き (bulb down) の場合は lower 内面で反射を主経路にする設計。  
スライダで簡単に切替可能 (`bulb ↓`)。

---

## 4. 3D プリントへの落とし込み

### 4.1 Vase mode (spiral) 前提
- シェードは**単層壁**。0.4 mm ノズル + line width 0.5 – 0.6 mm、1 perimeter。
- Spiralize outer contour (Cura) / Spiral Vase (PrusaSlicer) を有効化。
- Top/bottom solid = 0。infill = 0。

### 4.2 sin 波の 2 つのレベル — **surface 変調 と path 変調 は別物**

| | surface modulation (`lamp.js`) | **path modulation (`gcode.js`)** ★本命 |
|--|--|--|
| 操作対象 | シェードの**面**そのもの | ノズルが描く**線**そのもの |
| 出力 | STL（三角ポリゴン） | G-code (M82 連続押出) |
| 波形の精度 | 三角化エイリアスを受ける | 数式どおり書ける |
| Z 方向うねり | できない (1 contour = 1 z) | **できる** (層内で z が ±A 揺れる) |
| 推奨用途 | 設計段階のプレビュー | 実プリント |

#### path modulation の数式

層 j、周内媒介 `t ∈ [0,1)` で:

$$
\begin{aligned}
\theta     &= 2\pi t \\
z_{\text{layer}} &= z_0 + (j + t)\,\Delta z \\
z_{\text{wiggle}} &= A_z^{\text{path}} \, \sin\bigl(\omega_z\, z_{\text{layer}} + n_w \theta\bigr) \\
z_{\text{path}} &= z_{\text{layer}} + z_{\text{wiggle}} \\
r_{\text{path}} &= \rho(z_{\text{layer}}) + A_{\text{path}} \, \sin\bigl(n_{\text{path}}\,\theta + \psi_z\, z_{\text{layer}}\bigr) \\
x &= r_{\text{path}} \cos\theta,\quad y = r_{\text{path}} \sin\theta
\end{aligned}
$$

ポイントは `z_wiggle` 項 — **層内で z が ±Aₐ ぶれる**ので、ノズルが上下にうねった線を描く。Vase mode の正攻法では実現不可能（STL contour は単一 z）。これが「Gcode 直接いじる」の中身。

#### 押出量 E

絶対押出 (M82) で、距離ベースに計算:

$$
\Delta E = \frac{w_{\text{line}} \cdot \Delta z \cdot \|\Delta\mathbf{p}\|}{\pi (D_f / 2)^2}
$$

(`gcode.js : generateShadePath` 実装済み)

#### ビューアからの使い方
- 右上 GUI の `View` → `mode = toolpath` で **実際のノズル軌跡を 3D 描画**
- `★ Path sin (G-code)` フォルダで `A_z [mm]` (Z うねり) と `ωz` を触ると線がうにゃうにゃする
- `★ Export G-code (.gcode)` でプリンタ投入用ファイルを書き出し
- ホットキー `T` で surface ↔ toolpath 切替

### 4.3 推奨素材
| 素材 | 特徴 | 用途 |
|------|------|------|
| **ホワイト PLA (乳白系)** | 入手性◎、透過感が柔らかい | 量産候補本命 |
| **ナチュラル PETG** | 熱耐性 80°C、強度◎、艶感 | E17 白熱/LED 高出力対応 |
| **PolyLite LED Diffusion** | 光拡散最適化 PLA | 高付加価値版 |

**発熱リスク**: LED なら発熱は軽微だが、E26 白熱電球 40W 以上は PLA 不可。**LED 前提 + ソケット W 表示を明記**して販売する。

### 4.4 サイズ感（テーブルランプ）
- 全高: 300 – 360 mm
- 最大直径 (lower shade): 180 – 240 mm
- ベッドサイズ 220 mm (Ender 3 系) で lower を分割なしで出すには直径 210 mm 以下が安全。

スライダの `overallScale` はメートル→表示の倍率。実寸は各 shade の `r0` と `yOffset` を m 単位で入れて設計する。

---

## 5. 販売視点での留意点（技術面のみ）

| 項目 | 要点 |
|------|------|
| 電気部品 | 完成品として売るなら PSE（日本）/ UL（米）認証済みソケット+コードを使用。自作配線は販売不可に近い。 |
| 組立キット | シェード (樹脂部) のみ販売し、電気部品は「別途 E17 ソケット対応」で逃がすと規制ハードルが下がる。 |
| 発熱表示 | 「LED 電球専用、最大 W 記載」をラベルで明示。 |
| 意匠権 | PH シリーズは現行 Louis Poulsen の意匠。log spiral は**原理**なので特許切れだが、外観の直接模倣は避ける。本ランプは sin 波変調と 3 回対称 (L5) で独自性を担保する。 |
| 量産ばらつき | 単層壁は湿度と射出温度で径が ±0.3 mm ブレる。β, Az を少し大きめにして吸収。 |

---

## 6. 次のステップ候補

1. **G-code 直接生成**（sin 波の意図を完全に保存）
2. **配光シミュレーション**（光源→対数螺旋反射のレイトレース、実測 lx/m² と比較）
3. **ソケットホルダ仕様確定**（E17 or E26、ベース径、ケーブル抜け止め）
4. **アート版**: nθ を奇数にして 3 回対称を崩し、非対称 L5 エディションを別展開
