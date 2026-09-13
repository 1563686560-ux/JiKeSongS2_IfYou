// 美术交付工具库（纯逻辑，无副作用、无 CLI）—— 供 scripts/art.mjs 和单测共用。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ART_DIR = join(ROOT, 'art');
export const SPEC = JSON.parse(readFileSync(join(ROOT, 'content', 'art.spec.json'), 'utf8'));

// ── 图片头部解析：不装依赖也能读出宽高 ──────────────────────────────
export function parseImageSize(buf) {
  // PNG: 89 50 4E 47 0D 0A 1A 0A，随后 IHDR 的宽高各 4 字节（大端）
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { kind: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { kind: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP: RIFF....WEBP + VP8/VP8L/VP8X
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16);
    if (fourcc === 'VP8X') {
      return {
        kind: 'webp',
        width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
    if (fourcc === 'VP8 ') {
      return { kind: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { kind: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: 扫 SOFn 段
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { kind: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { kind: 'jpeg', width: 0, height: 0 };
  }
  // SVG: 从文本里抠 width/height 或 viewBox
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  if (/<svg[\s>]/i.test(head)) {
    const vb = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
    const w = /\bwidth\s*=\s*["']([\d.]+)/i.exec(head);
    const h = /\bheight\s*=\s*["']([\d.]+)/i.exec(head);
    if (w && h) return { kind: 'svg', width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
    if (vb) return { kind: 'svg', width: Math.round(Number(vb[3])), height: Math.round(Number(vb[4])) };
    return { kind: 'svg', width: 0, height: 0 };
  }
  return null;
}

// ── 校验（纯函数） ────────────────────────────────────────────────
export function validateArt(files, spec = SPEC) {
  const errors = [];
  const warnings = [];
  const known = new Set(Object.keys(spec.assets));
  const seen = new Map();

  for (const f of files) {
    const id = f.name.replace(/\.[^.]+$/, '');
    const ext = extname(f.name).toLowerCase();
    if (!spec.extensions.includes(ext)) {
      errors.push(`不支持的格式：${f.name}（可用：${spec.extensions.join(' / ')}）`);
      continue;
    }
    if (!known.has(id)) {
      errors.push(`文件名不是有效的 AssetId：${f.name}\n   合法 AssetId：${[...known].join('、')}`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`同一个 AssetId 交了两个文件：${seen.get(id)} 与 ${f.name}（请只留一个）`);
      continue;
    }
    seen.set(id, f.name);

    const want = spec.assets[id];
    if (!f.width || !f.height) {
      errors.push(`读不出图片尺寸：${f.name}（可能文件损坏或格式不受支持）`);
      continue;
    }
    if (f.width !== want.width || f.height !== want.height) {
      errors.push(
        `尺寸不对：${f.name} 是 ${f.width}×${f.height}，规格要求 ${want.width}×${want.height}（${want.desc}）`,
      );
    }
    if (f.bytes > spec.maxBytes) {
      errors.push(
        `体积超标：${f.name} ${(f.bytes / 1048576).toFixed(2)}MB > ${(spec.maxBytes / 1048576).toFixed(2)}MB。`
        + '\n   单文件构建会把图片内联进 HTML，体积会 ×1.33，太大就别扭了。请压缩或改 WebP。',
      );
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    delivered: [...seen.keys()],
    missing: [...known].filter((k) => !seen.has(k)),
  };
}

/** 读取 art/ 目录（跳过 README 和隐藏文件） */
export function readArtDir(dir = ART_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.') && name.toLowerCase() !== 'readme.md')
    .map((name) => {
      const buf = readFileSync(join(dir, name));
      const size = parseImageSize(buf);
      return { name, bytes: buf.length, width: size?.width ?? 0, height: size?.height ?? 0, kind: size?.kind ?? 'unknown' };
    });
}

// ── 最小的 PNG 生成器（只用于演练，无依赖）────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function makePng(width, height, [r, g, b] = [200, 180, 160]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // color type: truecolor
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0;   // filter: none
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      // 加点条纹，肉眼一眼能看出"这是演练生成的假图"
      const stripe = Math.floor(x / 80) % 2 === 0 ? 0 : 24;
      raw[p] = Math.min(255, r + stripe);
      raw[p + 1] = Math.min(255, g + stripe);
      raw[p + 2] = Math.min(255, b + stripe);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
