// Plush fur renderer (browser only, no dependencies).
//
// Takes the flat SVG body of a buddy, and paints it again as thousands of real hair strokes:
//   - soft 3D form lighting (light from the top-left, darker bottom-right)
//   - hairs lean outwards from the middle and fall down with gravity
//   - extra long hairs on the outline so the silhouette is fuzzy
//   - dark under-layer (depth) + lit top layer + sheen
// The result is a PNG (blob url) that covers the viewBox  -14 .. 114  (FUR_SPAN = 128 units).

export const FUR_PAD = 14;
export const FUR_SPAN = 128;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxBlur(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
  let cur = src;
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += cur[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / n;
        const xo = Math.max(0, x - r);
        const xi = Math.min(w - 1, x + r + 1);
        sum += cur[row + xi] - cur[row + xo];
      }
    }
    const out = new Float32Array(src.length);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / n;
        const yo = Math.max(0, y - r);
        const yi = Math.min(h - 1, y + r + 1);
        sum += tmp[yi * w + x] - tmp[yo * w + x];
      }
    }
    cur = out;
  }
  return cur;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rgb = (r: number, g: number, b: number) =>
  `rgb(${clamp(Math.round(r), 0, 255)},${clamp(Math.round(g), 0, 255)},${clamp(Math.round(b), 0, 255)})`;

/**
 * @param body  painted svg markup of the buddy body (viewBox 0..100 coordinates)
 * @param px    output size in pixels (square). 96 .. 384 is a good range.
 * @returns blob url of a png, or null when not possible (server, error)
 */
export async function renderFur(body: string, px: number, seed = 7): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const S = Math.round(clamp(px, 64, 512));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="${-FUR_PAD} ${-FUR_PAD} ${FUR_SPAN} ${FUR_SPAN}">` +
    body +
    `</svg>`;
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("fur: svg failed"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });

  const base = document.createElement("canvas");
  base.width = S;
  base.height = S;
  const bctx = base.getContext("2d");
  if (!bctx) return null;
  bctx.drawImage(img, 0, 0, S, S);
  const bd = bctx.getImageData(0, 0, S, S).data;

  const N = S * S;
  const A = new Float32Array(N);
  for (let i = 0; i < N; i++) A[i] = bd[i * 4 + 3] / 255;

  // ---- form: small + broad height maps -> light
  const rs = Math.max(1, Math.round(S * 0.022));
  const rb = Math.max(2, Math.round(S * 0.075));
  const Hs = boxBlur(A, S, S, rs, 2);
  const Hb = boxBlur(A, S, S, rb, 3);

  const LX = -0.45;
  const LY = -0.62;
  const LZ = 0.64;
  const ll = Math.hypot(LX, LY, LZ);
  const lx = LX / ll;
  const ly = LY / ll;
  const lz = LZ / ll;

  const shade = new Float32Array(N);
  const diff = new Float32Array(N);
  const outX = new Float32Array(N);
  const outY = new Float32Array(N);
  const K = rb * 1.7;
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const gx = (Hb[i + 1] - Hb[i - 1]) * 0.5 * 0.65 + (Hs[i + 1] - Hs[i - 1]) * 0.5 * 0.35;
      const gy = (Hb[i + S] - Hb[i - S]) * 0.5 * 0.65 + (Hs[i + S] - Hs[i - S]) * 0.5 * 0.35;
      const nx = -gx * K;
      const ny = -gy * K;
      const nl = Math.hypot(nx, ny, 1);
      const d = Math.max(0, (nx * lx + ny * ly + lz) / nl);
      diff[i] = d;
      const ao = 0.82 + 0.18 * clamp((Hb[i] - 0.15) / 0.7, 0, 1);
      shade[i] = (0.56 + 0.56 * d) * ao;
      outX[i] = -((Hb[i + 1] - Hb[i - 1]) * 0.5);
      outY[i] = -((Hb[i + S] - Hb[i - S]) * 0.5);
    }
  }

  // ---- under layer (so there are never holes between hairs)
  const out = document.createElement("canvas");
  out.width = S;
  out.height = S;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  const under = ctx.createImageData(S, S);
  const Asoft = boxBlur(A, S, S, 1, 1);
  for (let i = 0; i < N; i++) {
    const sh = shade[i] * 0.8;
    under.data[i * 4] = clamp(bd[i * 4] * sh, 0, 255);
    under.data[i * 4 + 1] = clamp(bd[i * 4 + 1] * sh, 0, 255);
    under.data[i * 4 + 2] = clamp(bd[i * 4 + 2] * sh, 0, 255);
    under.data[i * 4 + 3] = clamp(Asoft[i] * 255, 0, 255);
  }
  ctx.putImageData(under, 0, 0);

  // ---- sample lists
  const inside: number[] = [];
  const edge: number[] = [];
  for (let y = 2; y < S - 2; y++) {
    for (let x = 2; x < S - 2; x++) {
      const i = y * S + x;
      if (A[i] > 0.5) {
        inside.push(i);
        if (Hs[i] < 0.82) edge.push(i);
      }
    }
  }
  if (inside.length < 20) {
    return null;
  }

  const rand = rng(seed * 7919 + S);
  ctx.lineCap = "round";

  type Pass = { count: number; list: number[]; width: number; len: number; dark: number; alpha: number; sheen: boolean; fuzz: number };

  const hairPass = (p: Pass) => {
    for (let k = 0; k < p.count; k++) {
      const i = p.list[(rand() * p.list.length) | 0];
      const x0 = i % S;
      const y0 = (i / S) | 0;
      const rx = x0 + (rand() - 0.5) * 1.6;
      const ry = y0 + (rand() - 0.5) * 1.6;

      let ox = outX[i];
      let oy = outY[i];
      const m = Math.hypot(ox, oy);
      const edgeF = clamp(m * S * 0.5, 0, 1);
      if (m > 1e-6) {
        ox /= m;
        oy /= m;
      } else {
        ox = 0;
        oy = 0;
      }
      let dx = ox * edgeF * 0.95 + (rand() - 0.5) * 1.1;
      let dy = oy * edgeF * 0.95 + 0.7 + (rand() - 0.5) * 1.1;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;

      const len = S * p.len * (0.55 + rand() * 0.9) * (1 + p.fuzz * edgeF);
      const bend = (rand() - 0.5) * len * 0.5;
      const ex = rx + dx * len;
      const ey = ry + dy * len;
      const cx = (rx + ex) / 2 - dy * bend;
      const cy = (ry + ey) / 2 + dx * bend;

      const bi = i * 4;
      const sh = shade[i] * p.dark * (0.86 + rand() * 0.3);
      let r = bd[bi] * sh;
      let g = bd[bi + 1] * sh;
      let b = bd[bi + 2] * sh;

      if (p.sheen) {
        const d = diff[i];
        let w = d > 0.72 ? (d - 0.72) * 0.9 : 0;
        // rim light: outline hairs that face the light
        if (edgeF > 0.35 && ox * lx + oy * ly > 0.25) w += 0.22 * edgeF;
        if (w > 0) {
          w = Math.min(w, 0.45);
          r += (255 - r) * w;
          g += (255 - g) * w;
          b += (255 - b) * w;
        }
      }

      ctx.strokeStyle = rgb(r, g, b);
      ctx.globalAlpha = p.alpha;
      ctx.lineWidth = S * p.width * (0.8 + rand() * 0.5);
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.stroke();
    }
  };

  const area = inside.length;
  // 1) dark under-coat = depth
  hairPass({ count: area * 0.1, list: inside, width: 0.0095, len: 0.03, dark: 0.68, alpha: 0.95, sheen: false, fuzz: 0.6 });
  // 2) main dense coat (short, so the shape stays clear)
  hairPass({ count: area * 0.85, list: inside, width: 0.0052, len: 0.024, dark: 1.0, alpha: 0.95, sheen: true, fuzz: 0.5 });
  // 3) fuzzy outline
  hairPass({ count: edge.length * 1.0, list: edge, width: 0.0046, len: 0.03, dark: 1.02, alpha: 0.92, sheen: true, fuzz: 0.9 });
  // 4) a few thin flyaway hairs
  hairPass({ count: edge.length * 0.1, list: edge, width: 0.003, len: 0.045, dark: 1.05, alpha: 0.7, sheen: true, fuzz: 1.0 });
  // 5) soft top fluff for the lit side
  hairPass({ count: area * 0.16, list: inside, width: 0.0036, len: 0.02, dark: 1.12, alpha: 0.65, sheen: true, fuzz: 0.3 });
  ctx.globalAlpha = 1;

  return new Promise<string | null>((resolve) => {
    out.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob));
      else resolve(out.toDataURL("image/png"));
    }, "image/png");
  });
}
