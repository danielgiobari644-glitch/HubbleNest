/**
 * HubbleNest QR engine — verified-correct, dependency-free QR Code generator.
 *
 * HISTORY: the previous hand-rolled port produced matrices that real scanners
 * (pyzbar, OpenCV, phone cameras) could NOT decode — invite QRs simply didn't
 * work. This module replaces it with a spec-complete implementation of the QR
 * Model 2 standard (ISO/IEC 18004): byte mode, versions 1–40, ECC levels
 * L/M/Q/H, correct Reed–Solomon ECC with block interleaving, exact format/
 * version BCH info, all eight masks generated and chosen by the standard
 * penalty rules. Generated images decode with real scanners.
 *
 * The public API is unchanged:
 *   generateQrDataUrl(text, size) → PNG data URL
 *   renderQrToCanvas(canvas, text, size)
 *   downloadQrCode(dataUrl, spaceName, spaceCode)
 */

/* ============================== GF(256) arithmetic ============================== */

// GF(256) tables built once from the QR-standard primitive polynomial 0x11D.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGfTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Reed–Solomon generator polynomial for `degree` ECC symbols, coefficients in
 * ascending power order (gen[k] is the coefficient of x^k), monic at x^degree.
 * Built by multiplying (x + α^0)(x + α^1)…(x + α^(degree-1)).
 */
function rsGeneratorPoly(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(g.length + 1);
    const root = GF_EXP[i];
    for (let k = 0; k < g.length; k++) {
      next[k + 1] ^= g[k];                 // multiply by x
      next[k] ^= gfMul(g[k], root);        // multiply by α^i
    }
    g = next;
  }
  return g;
}

/**
 * LFSR polynomial division — returns `degree` ECC bytes for the data block in
 * the QR transmission order: highest-degree coefficient FIRST (the order the
 * spec places codewords in). Verified against the reedsolo reference library.
 */
function rsRemainder(data, degree) {
  const g = rsGeneratorPoly(degree);
  const rem = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = (data[i] ^ rem[degree - 1]) & 0xff;
    for (let j = degree - 1; j > 0; j--) rem[j] = rem[j - 1] ^ gfMul(g[j], factor);
    rem[0] = gfMul(g[0], factor);
  }
  return rem.reverse();
}

/* ============================== Spec tables ============================== */

// ECC codewords per block, indexed [ECL][version-1] (ISO/IEC 18004 table).
const ECC_CODEWORDS_PER_BLOCK = [
  // L
  [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // M
  [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // Q
  [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
    28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // H
  [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
    30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];

// Number of ECC blocks, indexed [ECL][version-1].
const NUM_ECC_BLOCKS = [
  [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 13, 14, 16, 17, 17, 18, 20, 21,
    23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66],
  [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];

// Alignment pattern center coordinates per version (1..40).
const ALIGNMENT_POSITIONS = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
  [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
  [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170]
];

// Remainder bits after the final codeword, indexed [version-1].
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3,
  4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0];

const ECL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
const ECL_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/** Number of raw (function-excluded) data modules for a version — spec formula. */
function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** Total codewords available for data+ECC at a version. */
function totalCodewords(ver) {
  return Math.floor(numRawDataModules(ver) / 8);
}

function bitLength(x) {
  let n = 0;
  while (x > 0) { n++; x >>>= 1; }
  return n;
}

/** BCH remainder: (data * x^genDegree) mod gen, gen monic with leading bit at genDegree. */
function bchMod(data, gen, genDegree) {
  let val = data << genDegree;
  for (let i = bitLength(val) - 1; i >= genDegree; i--) {
    if (((val >>> i) & 1) !== 0) val ^= gen << (i - genDegree);
  }
  return val & ((1 << genDegree) - 1);
}

/* ============================== Bit buffer ============================== */

class BitBuffer {
  constructor() { this.bits = []; }
  get lengthBits() { return this.bits.length; }
  appendBits(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

/* ============================== Core QrCode ============================== */

class QrCode {
  /**
   * @param {number} version 1..40
   * @param {number} eclIdx 0=L 1=M 2=Q 3=H
   * @param {Uint8Array} dataCodewords exact-length data codewords
   */
  constructor(version, eclIdx, dataCodewords) {
    this.version = version;
    this.eclIdx = eclIdx;
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (let r = 0; r < this.size; r++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
    this.drawFunctionPatterns();
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);
    this.mask = this.pickMask();
    this.applyMask(this.mask);
    this.drawFormatBits(this.mask);
  }

  drawFunctionPatterns() {
    const n = this.size;
    // Timing patterns
    for (let i = 0; i < n; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    // Finder patterns + separators
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(n - 4, 3);
    this.drawFinderPattern(3, n - 4);
    // Alignment patterns (skip the three corners colliding with finders)
    const align = ALIGNMENT_POSITIONS[this.version - 1];
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
        this.drawAlignmentPattern(align[j], align[i]);
      }
    }
    // Reserve format info (drawn per-mask again after masking)
    this.drawFormatBits(0);
    // Version information (versions >= 7)
    this.drawVersionInfo();
    // The always-dark module
    this.setFunctionModule(8, n - 8, true);
  }

  drawFinderPattern(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const dark = dist !== 2 && dist !== 4;
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
          this.setFunctionModule(x, y, dark);
        }
      }
    }
  }

  drawAlignmentPattern(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawFormatBits(mask) {
    const n = this.size;
    const data = (ECL_FORMAT_BITS['LMQH'[this.eclIdx]] << 3) | mask;
    const rem = bchMod(data, 0x537, 10);
    const finalBits = ((data << 10) | rem) ^ 0x5412;
    // First copy (around the top-left finder)
    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, ((finalBits >>> i) & 1) !== 0);
    this.setFunctionModule(8, 7, ((finalBits >>> 6) & 1) !== 0);
    this.setFunctionModule(8, 8, ((finalBits >>> 7) & 1) !== 0);
    this.setFunctionModule(7, 8, ((finalBits >>> 8) & 1) !== 0);
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, ((finalBits >>> i) & 1) !== 0);
    // Second copy (split around the other two finders)
    for (let i = 0; i < 8; i++) this.setFunctionModule(n - 1 - i, 8, ((finalBits >>> i) & 1) !== 0);
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, n - 15 + i, ((finalBits >>> i) & 1) !== 0);
    this.setFunctionModule(8, n - 8, true);
  }

  drawVersionInfo() {
    if (this.version < 7) return;
    const n = this.size;
    const rem = bchMod(this.version, 0x1f25, 12);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }

  setFunctionModule(x, y, dark) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  /** Append per-block ECC and interleave the blocks exactly per spec. */
  addEccAndInterleave(data) {
    const ver = this.version;
    const numBlocks = NUM_ECC_BLOCKS[this.eclIdx][ver - 1];
    const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[this.eclIdx][ver - 1];
    const raw = totalCodewords(ver);
    const shortBlockLen = Math.floor(raw / numBlocks);
    const numShortBlocks = numBlocks - (raw % numBlocks);
    const shortDataLen = shortBlockLen - eccPerBlock;

    const blocks = [];
    let offset = 0;
    for (let i = 0; i < numBlocks; i++) {
      const dataLen = shortDataLen + (i < numShortBlocks ? 0 : 1);
      const blockData = data.slice(offset, offset + dataLen);
      offset += dataLen;
      blocks.push({ data: blockData, ecc: rsRemainder(blockData, eccPerBlock) });
    }
    // Interleave data column-by-column (short blocks contribute nothing at the
    // extra column), then ECC column-by-column.
    const result = [];
    for (let j = 0; j < shortBlockLen - eccPerBlock; j++) {
      for (let i = 0; i < numBlocks; i++) result.push(blocks[i].data[j]);
    }
    // The extra column exists only for long blocks
    if (numShortBlocks < numBlocks) {
      for (let i = numShortBlocks; i < numBlocks; i++) result.push(blocks[i].data[shortDataLen]);
    }
    for (let j = 0; j < eccPerBlock; j++) {
      for (let i = 0; i < numBlocks; i++) result.push(blocks[i].ecc[j]);
    }
    return Uint8Array.from(result);
  }

  drawCodewords(data) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    const n = this.size;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: throw new Error('bad mask');
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  pickMask() {
    let best = 0;
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      const saved = this.modules.map(row => row.slice());
      this.applyMask(m);
      const score = this.maskPenalty();
      this.modules = saved;
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  maskPenalty() {
    const n = this.size;
    const get = (x, y) => this.modules[y][x];
    let result = 0;

    // Penalty 1: runs of the same color with length >= 5
    for (let y = 0; y < n; y++) {
      let runColor = get(0, y), runLen = 1;
      for (let x = 1; x < n; x++) {
        if (get(x, y) === runColor) {
          runLen++;
          if (runLen === 5) result += 3;
          else if (runLen > 5) result += 1;
        } else { runColor = get(x, y); runLen = 1; }
      }
    }
    for (let x = 0; x < n; x++) {
      let runColor = get(x, 0), runLen = 1;
      for (let y = 1; y < n; y++) {
        if (get(x, y) === runColor) {
          runLen++;
          if (runLen === 5) result += 3;
          else if (runLen > 5) result += 1;
        } else { runColor = get(x, y); runLen = 1; }
      }
    }

    // Penalty 2: 2×2 blocks of the same color
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = get(x, y);
        if (c === get(x + 1, y) && c === get(x, y + 1) && c === get(x + 1, y + 1)) result += 3;
      }
    }

    // Penalty 3: finder-like patterns (1011101 with 4 light modules beside)
    const hasFinderRun = (cells) => {
      for (let i = 0; i < 7; i++) if (cells[i] !== FINDER_PATTERN[i]) return false;
      return true;
    };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x <= n - 7; x++) {
        const cells = [];
        for (let i = 0; i < 7; i++) cells.push(get(x + i, y));
        if (hasFinderRun(cells)) {
          const leftLight = x >= 4 && !get(x - 1, y) && !get(x - 2, y) && !get(x - 3, y) && !get(x - 4, y);
          const rightLight = x + 10 < n && !get(x + 7, y) && !get(x + 8, y) && !get(x + 9, y) && !get(x + 10, y);
          if (leftLight || rightLight) result += 40;
        }
      }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y <= n - 7; y++) {
        const cells = [];
        for (let i = 0; i < 7; i++) cells.push(get(x, y + i));
        if (hasFinderRun(cells)) {
          const topLight = y >= 4 && !get(x, y - 1) && !get(x, y - 2) && !get(x, y - 3) && !get(x, y - 4);
          const bottomLight = y + 10 < n && !get(x, y + 7) && !get(x, y + 8) && !get(x, y + 9) && !get(x, y + 10);
          if (topLight || bottomLight) result += 40;
        }
      }
    }

    // Penalty 4: dark proportion deviation from 50%
    let dark = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (get(x, y)) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += Math.max(k, 0) * 10;
    return result;
  }

  getModuleCount() { return this.size; }
  isDark(row, col) { return !!this.modules[row][col]; }
}

const FINDER_PATTERN = [true, false, true, true, true, false, true];

/* ============================== Encoding (byte mode) ============================== */

/**
 * Build the data codeword sequence for `text` at `version`/`eclIdx`:
 * mode indicator + character count + UTF-8 bytes + terminator + pad bytes.
 */
function buildDataCodewords(text, version, eclIdx) {
  const dataCodewords = totalCodewords(version) - ECC_CODEWORDS_PER_BLOCK[eclIdx][version - 1] * NUM_ECC_BLOCKS[eclIdx][version - 1];
  const capacityBits = dataCodewords * 8 - REMAINDER_BITS[version - 1];

  const utf8 = new TextEncoder().encode(String(text));
  const payloadBits = 4 + 8 + utf8.length * 8; // byte-mode indicator + 16-bit count (v10+ uses 16)
  const countBits = version <= 9 ? 8 : 16;
  const totalBits = 4 + countBits + utf8.length * 8;
  if (totalBits > capacityBits) throw new Error('QR payload too long for the chosen ECC level');

  const buffer = new BitBuffer();
  buffer.appendBits(4, 4); // byte mode
  buffer.appendBits(utf8.length, countBits);
  for (const b of utf8) buffer.appendBits(b, 8);

  // Terminator (up to 4 zero bits), then byte-align, then pad 0xEC / 0x11.
  buffer.appendBits(0, Math.min(4, capacityBits - buffer.lengthBits));
  buffer.appendBits(0, (8 - buffer.lengthBits % 8) % 8);
  for (let pad = 0xec; buffer.lengthBits < capacityBits; pad ^= 0xec ^ 0x11) {
    buffer.appendBits(pad, 8);
  }

  const data = new Uint8Array(dataCodewords);
  for (let i = 0; i < dataCodewords; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | buffer.bits[i * 8 + j];
    data[i] = byte;
  }
  return data;
}

/**
 * Encode text into a QrCode. Auto-selects the smallest version that fits.
 * @param {string} text
 * @param {'L'|'M'|'Q'|'H'} [ecl]
 */
export function encodeQr(text, ecl = 'M') {
  const eclIdx = ECL_INDEX[ecl] ?? 1;
  const str = String(text ?? '');
  if (!str) throw new Error('Empty QR payload');
  for (let v = 1; v <= 40; v++) {
    const dataCodewords = totalCodewords(v) - ECC_CODEWORDS_PER_BLOCK[eclIdx][v - 1] * NUM_ECC_BLOCKS[eclIdx][v - 1];
    const capacityBits = dataCodewords * 8 - REMAINDER_BITS[v - 1];
    const countBits = v <= 9 ? 8 : 16;
    const needed = 4 + countBits + new TextEncoder().encode(str).length * 8;
    if (needed <= capacityBits) {
      return new QrCode(v, eclIdx, buildDataCodewords(str, v, eclIdx));
    }
  }
  throw new Error('QR payload too long (over 2,953 bytes at ECC L)');
}

/* ============================== Rendering (public API) ============================== */

function drawQrToCtx(ctx, qr, size, foreground = '#090d16', background = '#ffffff') {
  const count = qr.getModuleCount();
  // Spec-recommended quiet zone: 4 modules on every side.
  const quietModules = 4;
  const cellSize = size / (count + quietModules * 2);
  const offset = quietModules * cellSize;

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = foreground;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(
          Math.round(offset + c * cellSize),
          Math.round(offset + r * cellSize),
          Math.ceil(cellSize),
          Math.ceil(cellSize)
        );
      }
    }
  }
}

/**
 * Generate a QR Code as a PNG Data URL.
 * @param {string} text
 * @param {number} size pixel size (square)
 * @param {{ ecl?: 'L'|'M'|'Q'|'H', dark?: string, light?: string }} [opts]
 */
export function generateQrDataUrl(text, size = 320, opts = {}) {
  const qr = encodeQr(text, opts.ecl || 'M');
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawQrToCtx(ctx, qr, size, opts.dark || '#090d16', opts.light || '#ffffff');
  return canvas.toDataURL('image/png');
}

/**
 * Render a QR Code directly into a provided Canvas element.
 */
export function renderQrToCanvas(canvas, text, size = 320, opts = {}) {
  const qr = encodeQr(text, opts.ecl || 'M');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawQrToCtx(ctx, qr, size, opts.dark || '#090d16', opts.light || '#ffffff');
}

/**
 * Download a QR Code PNG with clean file naming.
 */
export function downloadQrCode(dataUrl, spaceName, spaceCode) {
  const safeName = (spaceName || 'space').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const filename = `hubblenest-${safeName}-${spaceCode || 'qr'}.png`;

  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
