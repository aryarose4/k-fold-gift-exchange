// k-Fold Gift Exchange Generator "secret mode" cryptography.
// Dependency-free, browser + Node v12 (BigInt) compatible.

export const P = BigInt("334217594647014894373927380688320646643");
export const Q = BigInt("167108797323507447186963690344160323321");
// P is a 128-bit safe prime, P = 2Q+1 with Q prime; G is a primitive root
// mod P (order 2Q = P-1): G^Q != 1 and G^2 != 1 mod P.
export const G = BigInt("251858852279310385284005414929348283450");

export const PAD_BITS = 64;

// These values are secret key material, so the default randomness must be a
// CSPRNG, not Math.random. The injectable `rng` parameters remain for
// deterministic tests.
function makeDefaultRng() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    return function () {
      c.getRandomValues(buf);
      return buf[0] / 4294967296;
    };
  }
  return Math.random; // only reached in exotic hosts / non-crypto contexts
}
const defaultRng = makeDefaultRng();

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function checksum(payload) {
  return (fnv1a(payload) % 1296).toString(36).padStart(2, "0");
}

// Tokens are plain lowercase alphanumerics: <tier><payload><checksum>.
// There are no `:`, `.` or `-` separators, so a double-click selects the
// whole key and less technical users can retype it without hunting for
// punctuation. The two-character checksum is always the final pair.
//
// Affine payload: <giver><offset>, two equal-width base36 fields. The width
// is not stored: it is inferred as payload.length / 2, so the token carries no
// width character and the row space is not capped by a one-digit width field.
function makeToken(tier, payload) {
  const body = tier + payload;
  return body + checksum(body);
}

export function parseToken(token) {
  if (typeof token !== "string") throw new Error("token: not a string");
  const t = token.trim().toLowerCase();
  if (!/^[0-9a-z]+$/.test(t)) throw new Error("token: only letters and digits are allowed");
  if (t.length < 4) throw new Error("token: too short");
  const body = t.slice(0, -2);
  const cc = t.slice(-2);
  if (checksum(body) !== cc) throw new Error("token: checksum mismatch");
  const tier = body[0];
  const payload = body.slice(1);
  if (tier === "a") {
    if (payload.length < 2 || payload.length % 2 !== 0) {
      throw new Error("token: affine payload misaligned");
    }
    const width = payload.length / 2;
    if (width > AFFINE_MAX_DIGITS) throw new Error("token: affine field too wide");
    const i = Number(b36ToBig(payload.slice(0, width)));
    const b = b36ToBig(payload.slice(width));
    if (!Number.isInteger(i) || i < 0) throw new Error("token: bad giver index");
    if (b < 0n) throw new Error("token: bad offset");
    return { tier, fields: { i, b } };
  }
  if (tier === "e") {
    return { tier, fields: { x: b36ToBig(payload) } };
  }
  if (tier === "p") {
    return { tier, fields: { y: b36ToBig(payload) } };
  }
  throw new Error("token: unknown tier '" + tier + "'");
}

// ---------------------------------------------------------------------------
// Row encoding. A giver's row — the set of k recipients — is written as an
// n-bit mask: bit r is 1 exactly when participant r receives a gift from that
// giver. With the recipients 0 <= c_1 < ... < c_k < n,
//
//     X = 2^{c_1} + ... + 2^{c_k}   in [0, 2^n).
//
// This is injective and dead simple, at the cost of being less compact than a
// combinadic rank, which would span only the C(n,k) rows that actually occur.
// It is all the additive one-time pad below needs: secrecy holds for any
// modulus p >= 2^n, independent of how rows are numbered.
// ---------------------------------------------------------------------------

export const AFFINE_MAX_DIGITS = 1000; // sanity cap on base36 field width (2^n row space)

function rowSpace(n, k) {
  return 2n ** BigInt(n);
}

export function encodeRow(indices, n) {
  let x = 0n;
  for (const r of indices) x |= 1n << BigInt(r);
  return x;
}

export function decodeRow(x, n, k) {
  let v = BigInt(x);
  if (v < 0n) throw new Error("decodeRow: negative value");
  const out = [];
  for (let r = 0; r < n; r++) {
    if (v & 1n) out.push(r);
    v >>= 1n;
  }
  if (v !== 0n) throw new Error("decodeRow: value out of range");
  if (out.length !== k) throw new Error("decodeRow: expected " + k + " recipients");
  return out;
}

// Row space 2^n and the additive modulus p = 2^n + 1, plus the base36 field
// width the token uses. The log guard rejects an over-wide row space before
// computing an astronomically large 2^n.
export function affineModulus(n, k) {
  if (n >= 2 && n * Math.log(2) > AFFINE_MAX_DIGITS * Math.log(36)) {
    throw new Error("affine: row space 2^n is too large (n = " + n + ")");
  }
  const space = rowSpace(n, k);
  const width = Math.max(1, bigToB36(space).length);
  if (width > AFFINE_MAX_DIGITS) {
    throw new Error("affine: row space 2^n needs " + width + " base36 digits (max " + AFFINE_MAX_DIGITS + ")");
  }
  return { space, width, p: space + 1n };
}

export function modInverseBig(a, p) {
  if (typeof p !== "bigint" || p < 2n) throw new Error("modInverseBig: modulus must be a BigInt >= 2");
  let oldR = ((a % p) + p) % p;
  let r = p;
  let oldS = 1n;
  let s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("modInverseBig: gcd(a, p) != 1");
  return ((oldS % p) + p) % p;
}

export function modPow(base, exp, mod) {
  if (exp < 0n) throw new Error("modPow: negative exponent");
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  let result = 1n;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

export function bigToB36(x) {
  if (typeof x !== "bigint" || x < 0n) throw new Error("bigToB36: need non-negative BigInt");
  if (x === 0n) return "0";
  const base = 36n;
  let s = "";
  while (x > 0n) {
    s = (x % base).toString(36) + s;
    x /= base;
  }
  return s;
}

export function b36ToBig(s) {
  if (typeof s !== "string" || !/^[0-9a-z]+$/.test(s)) {
    throw new Error("b36ToBig: invalid base36 string");
  }
  const base = 36n;
  let x = 0n;
  for (let i = 0; i < s.length; i++) {
    x = x * base + BigInt(parseInt(s[i], 36));
  }
  return x;
}

function randomBigInt(bits, rng) {
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);
  for (let j = 0; j < bytes; j++) buf[j] = Math.floor(rng() * 256) & 0xff;
  let x = 0n;
  for (let j = 0; j < bytes; j++) x = (x << 8n) | BigInt(buf[j]);
  return x;
}

function randomBigIntBelow(bound, rng) {
  const bits = bound.toString(2).length;
  for (;;) {
    const v = randomBigInt(bits, rng);
    if (v < bound) return v;
  }
}

export function affineEncrypt(roster, k, assignments, rng = defaultRng) {
  const n = roster.length;
  if (assignments.length !== n) throw new Error("affineEncrypt: assignment rows != roster size");
  const { width, p } = affineModulus(n, k);
  const enc = (v) => bigToB36(v).padStart(width, "0");
  const rows = [];
  const keys = [];
  for (let i = 0; i < n; i++) {
    if (assignments[i].length !== k) throw new Error("affineEncrypt: row " + i + " length != k");
    const b = randomBigIntBelow(p, rng);
    const c = (encodeRow(assignments[i], n) + b) % p;
    rows.push(bigToB36(c));
    keys.push(makeToken("a", enc(BigInt(i)) + enc(b)));
  }
  const message = { v: 1, tier: "affine", p: bigToB36(p), k, roster: roster.slice(), rows };
  return { message, keys };
}

export function affineDecryptRow(message, token) {
  const { tier, fields } = parseToken(token);
  if (tier !== "a") throw new Error("affineDecryptRow: token tier is not 'a'");
  const p = b36ToBig(message.p);
  const { i, b } = fields;
  if (!Number.isInteger(i) || i < 0 || i >= message.rows.length) {
    throw new Error("affineDecryptRow: giver index out of range");
  }
  const c = b36ToBig(message.rows[i]);
  if (c < 0n || c >= p) throw new Error("affineDecryptRow: bad ciphertext");
  const x = (((c - b) % p) + p) % p;
  return decodeRow(x, message.roster.length, message.k);
}

export function elgamalKeypair(rng = defaultRng) {
  const x = 1n + randomBigIntBelow(Q - 1n, rng);
  const y = modPow(G, x, P);
  return {
    priv: makeToken("e", bigToB36(x)),
    pub: makeToken("p", bigToB36(y)),
  };
}

function elgamalEncryptCell(idx, y, rng) {
  const pad = BigInt(PAD_BITS);
  const padRange = 1n << pad;
  let r = randomBigInt(PAD_BITS, rng) % padRange;
  let m = ((BigInt(idx) + 1n) << pad) | r;
  while (m % P === 0n) {
    r = randomBigInt(PAD_BITS, rng) % padRange;
    m = ((BigInt(idx) + 1n) << pad) | r;
  }
  const e = 1n + randomBigIntBelow(Q - 1n, rng);
  const c1 = modPow(G, e, P);
  const c2 = (m * modPow(y, e, P)) % P;
  return [bigToB36(c1), bigToB36(c2)];
}

function elgamalRow(assignments, i, k, y, rng) {
  if (assignments[i].length !== k) throw new Error("elgamalEncryptRows: row " + i + " length != k");
  const row = [];
  for (let t = 0; t < k; t++) row.push(elgamalEncryptCell(assignments[i][t], y, rng));
  return row;
}

function checkElgamalArgs(roster, assignments, pubTokens) {
  const n = roster.length;
  if (assignments.length !== n) throw new Error("elgamalEncryptRows: assignment rows != roster size");
  if (pubTokens.length !== n) throw new Error("elgamalEncryptRows: pubTokens length != roster size");
}

function elgamalMessage(roster, k, pubTokens, rows) {
  return {
    v: 1,
    tier: "elgamal",
    p: bigToB36(P),
    q: bigToB36(Q),
    g: bigToB36(G),
    k,
    roster: roster.slice(),
    pubs: pubTokens.slice(),
    rows,
  };
}

export function elgamalEncryptRows(roster, k, assignments, pubTokens, rng = defaultRng) {
  checkElgamalArgs(roster, assignments, pubTokens);
  const rows = [];
  for (let i = 0; i < roster.length; i++) {
    const parsed = parseToken(pubTokens[i]);
    if (parsed.tier !== "p") throw new Error("elgamalEncryptRows: token " + i + " is not a public key");
    rows.push(elgamalRow(assignments, i, k, parsed.fields.y, rng));
  }
  return { message: elgamalMessage(roster, k, pubTokens, rows) };
}

// Chunked variant: yields between givers so a large roster does not block the
// UI thread for the whole O(n*k) modexp run.
export async function elgamalEncryptRowsChunked(roster, k, assignments, pubTokens, rng = defaultRng, yieldFn) {
  checkElgamalArgs(roster, assignments, pubTokens);
  const yieldNow = typeof yieldFn === "function" ? yieldFn : () => new Promise((res) => setTimeout(res, 0));
  const rows = [];
  for (let i = 0; i < roster.length; i++) {
    const parsed = parseToken(pubTokens[i]);
    if (parsed.tier !== "p") throw new Error("elgamalEncryptRows: token " + i + " is not a public key");
    rows.push(elgamalRow(assignments, i, k, parsed.fields.y, rng));
    await yieldNow();
  }
  return { message: elgamalMessage(roster, k, pubTokens, rows) };
}

export function decryptRow(message, token) {
  if (!message || typeof message !== "object") throw new Error("decryptRow: no message");
  if (message.tier === "affine") {
    const { fields } = parseToken(token);
    const giver = fields.i;
    const recipients = affineDecryptRow(message, token);
    return finishRow(message, giver, recipients);
  }
  if (message.tier === "elgamal") {
    const { tier, fields } = parseToken(token);
    if (tier !== "e") throw new Error("decryptRow: elgamal needs a private key token");
    const x = fields.x;
    const y = modPow(G, x, P);
    const wantPub = makeToken("p", bigToB36(y));
    let giver = -1;
    for (let i = 0; i < message.pubs.length; i++) {
      if (message.pubs[i] === wantPub) { giver = i; break; }
    }
    if (giver < 0) throw new Error("decryptRow: no matching public key in message");
    const recipients = [];
    for (let t = 0; t < message.rows[giver].length; t++) {
      const cell = message.rows[giver][t];
      const c1 = b36ToBig(cell[0]);
      const c2 = b36ToBig(cell[1]);
      const s = modPow(c1, x, P);
      const m = (c2 * modInverseBig(s, P)) % P;
      recipients.push(Number(m >> BigInt(PAD_BITS)) - 1);
    }
    return finishRow(message, giver, recipients);
  }
  throw new Error("decryptRow: unknown tier '" + message.tier + "'");
}

function finishRow(message, giver, recipients) {
  const roster = message.roster;
  for (const r of recipients) {
    if (!Number.isInteger(r) || r < 0 || r >= roster.length) {
      throw new Error("decryptRow: recipient index out of range");
    }
  }
  return { giver, recipients, names: recipients.map((r) => roster[r]) };
}

export function encodeMessage(message) {
  return JSON.stringify(message);
}

export function decodeMessage(text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    throw new Error("decodeMessage: invalid JSON");
  }
  if (!msg || typeof msg !== "object") throw new Error("decodeMessage: not an object");
  if (msg.v !== 1) throw new Error("decodeMessage: unsupported version");
  if (msg.tier !== "affine" && msg.tier !== "elgamal") throw new Error("decodeMessage: unknown tier");
  if (!Array.isArray(msg.roster)) throw new Error("decodeMessage: roster missing");
  if (!Array.isArray(msg.rows)) throw new Error("decodeMessage: rows missing");
  if (typeof msg.k !== "number") throw new Error("decodeMessage: k missing");
  if (msg.rows.length !== msg.roster.length) throw new Error("decodeMessage: rows/roster size mismatch");
  if (msg.tier === "affine") {
    if (typeof msg.p !== "string" || !/^[0-9a-z]+$/.test(msg.p)) {
      throw new Error("decodeMessage: invalid affine modulus");
    }
    if (!Number.isInteger(msg.k) || msg.k < 1 || msg.k >= msg.roster.length) {
      throw new Error("decodeMessage: k out of range for affine roster");
    }
    let params;
    try {
      params = affineModulus(msg.roster.length, msg.k);
    } catch (e) {
      throw new Error("decodeMessage: affine row space too large");
    }
    if (msg.p !== bigToB36(params.p)) {
      throw new Error("decodeMessage: affine modulus must be 2^n + 1");
    }
    for (const c of msg.rows) {
      // Bound the string before parsing: b36ToBig is superlinear, and a valid
      // ciphertext is at most `width` base36 digits.
      if (typeof c !== "string" || c.length > params.width || !/^[0-9a-z]+$/.test(c)) {
        throw new Error("decodeMessage: bad affine ciphertext");
      }
      if (b36ToBig(c) >= params.p) {
        throw new Error("decodeMessage: bad affine ciphertext");
      }
    }
  }
  if (msg.tier === "elgamal" && !Array.isArray(msg.pubs)) throw new Error("decodeMessage: pubs missing");
  return msg;
}

// ---------------------------------------------------------------------------
// Organizer share string: "<encoded-name>:<token>", e.g. "Alice_Smith:p1234abcd".
//
// The keypair generator emits this so a participant can send the organizer a
// single string; the organizer pastes it and both the name and the public key
// fill in at once. Names are whitespace-free tokens: spaces become `_`, and
// the two characters the keygen input forbids (`:` and `_`) are stripped, so
// the first colon is always the separator even if someone retypes the line.
// ---------------------------------------------------------------------------

export function encodeName(name) {
  return String(name)
    .trim()
    .replace(/[:_]/g, "")
    .replace(/\s+/g, "_");
}

export function decodeName(encoded) {
  return String(encoded).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

export function makeShareString(name, token) {
  const n = encodeName(name);
  if (!n) throw new Error("makeShareString: need a name");
  return n + ":" + String(token).trim();
}

// Returns { name, token } when `text` looks like "<name>:<token>", else null.
// The name's `_` separators are turned back into spaces. The token part is
// not validated here (callers use parseToken for that).
export function parseShareString(text) {
  if (typeof text !== "string") return null;
  const s = text.trim();
  const idx = s.indexOf(":");
  if (idx < 0) return null;
  const name = decodeName(s.slice(0, idx));
  const token = s.slice(idx + 1).trim();
  if (!name || !token) return null;
  return { name, token };
}
