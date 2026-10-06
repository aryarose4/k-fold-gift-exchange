// Node harness for assets/js/giftexchange/crypto.js (copied in by
// run-crypto-tests.sh). Dependency-free, Node v12.

import {
  P,
  Q,
  G,
  PAD_BITS,
  modPow,
  modInverseBig,
  bigToB36,
  b36ToBig,
  encodeRow,
  decodeRow,
  affineModulus,
  AFFINE_MAX_DIGITS,
  parseToken,
  affineEncrypt,
  affineDecryptRow,
  elgamalKeypair,
  elgamalEncryptRows,
  elgamalEncryptRowsChunked,
  decryptRow,
  encodeMessage,
  decodeMessage,
  makeShareString,
  parseShareString,
  encodeName,
  decodeName,
} from "./crypto.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("  ok   " + name);
  } else {
    failures++;
    console.log("  FAIL " + name + (detail ? " -- " + detail : ""));
  }
}

function makeAssignments(rng, n, k) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const pool = [];
    for (let j = 0; j < n; j++) pool.push(j);
    for (let j = pool.length - 1; j > 0; j--) {
      const s = Math.floor(rng() * (j + 1));
      const tmp = pool[j];
      pool[j] = pool[s];
      pool[s] = tmp;
    }
    rows.push(pool.slice(0, k));
  }
  return rows;
}

function eqNums(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

console.log("Tier 0 -- utilities");

check("modPow(2,10,1000) === 24n", modPow(2n, 10n, 1000n) === 24n);
check("modPow(G,Q,P) !== 1n", modPow(G, Q, P) !== 1n);
check("modPow(G,2Q,P) === 1n", modPow(G, 2n * Q, P) === 1n);
check("G !== 1n", G !== 1n);
check("P === 2Q+1", P === 2n * Q + 1n);
check("P is 128-bit", P.toString(2).length === 128);

const invBig = modInverseBig(G, P);
check("modInverseBig round-trip", (G * invBig) % P === 1n);

for (const x of [0n, 1n, 35n, 36n, 1295n, 1296n, P, Q * G]) {
  check("base36 round-trip for " + x.toString().slice(0, 12), b36ToBig(bigToB36(x)) === x);
}
check("bigToB36(0) === '0'", bigToB36(0n) === "0");

console.log("Tier 0 -- n-bit mask row encoding");

{
  let bijection = true;
  let inRange = true;
  for (let n = 2; n <= 9; n++) {
    for (let k = 1; k < n; k++) {
      const space = 2n ** BigInt(n);
      const seen = new Set();
      const subset = [];
      (function rec(start) {
        if (subset.length === k) {
          const r = encodeRow(subset, n);
          if (seen.has(r.toString()) || r < 0n || r >= space) bijection = false;
          seen.add(r.toString());
          if (!eqNums(decodeRow(r, n, k), subset)) bijection = false;
          return;
        }
        for (let j = start; j < n; j++) {
          subset.push(j);
          rec(j + 1);
          subset.pop();
        }
      })(0);
      if (seen.size === 0) inRange = false;
    }
  }
  check("encode/decode is injective and exact for 2<=n<=9", bijection && inRange);
}

{
  const a = affineModulus(5, 2);
  check("affineModulus p = 2^n + 1", a.p === 33n && a.space === 32n);
  check("affineModulus width is base36 width of 2^n", a.width === bigToB36(32n).length);
  check("AFFINE_MAX_DIGITS === 1000", AFFINE_MAX_DIGITS === 1000);
  const b = affineModulus(5, 4);
  check("affineModulus is independent of k", b.p === a.p && b.space === a.space);
}

check("encodeRow ignores input order", encodeRow([4, 1], 5) === encodeRow([1, 4], 5));
check("encodeRow golden vector ([1,4], n=5) === 18", encodeRow([1, 4], 5) === 18n);
check("decodeRow golden vector (18, n=5, k=2) === [1,4]", eqNums(decodeRow(18n, 5, 2), [1, 4]));
check("decodeRow keeps a leading zero index", eqNums(decodeRow(encodeRow([0, 3], 5), 5, 2), [0, 3]));

{
  let rejects = true;
  for (const bad of [-1n, 32n, 125n]) {
    try {
      decodeRow(bad, 5, 2);
      rejects = false;
    } catch (e) {
      // expected
    }
  }
  check("decodeRow rejects out-of-range values", rejects);
}

console.log("Tier 1 -- additive one-time pad over Z_{2^n+1}");

let affineOk = true;
let affineShapes = 0;
for (let n = 2; n <= 20; n++) {
  for (let k = 1; k < n; k++) {
    affineShapes++;
    const rng = mulberry32(1000 + n * 31 + k);
    const roster = [];
    for (let i = 0; i < n; i++) roster.push("P" + i);
    const assignments = makeAssignments(rng, n, k);
    const { message, keys } = affineEncrypt(roster, k, assignments, rng);
    if (message.p !== bigToB36(2n ** BigInt(n) + 1n)) affineOk = false;
    for (let i = 0; i < n; i++) {
      const want = assignments[i].slice().sort((a, b) => a - b);
      const got = affineDecryptRow(message, keys[i]);
      if (!eqNums(got, want)) affineOk = false;
      const row = decryptRow(message, keys[i]);
      if (row.giver !== i || !eqNums(row.names, want.map((r) => roster[r]))) {
        affineOk = false;
      }
    }
  }
}
check("additive round-trip for all 2<=n<=20, 1<=k<n (" + affineShapes + " shapes)", affineOk);

{
  const rng = mulberry32(7);
  const roster = ["A", "B", "C", "D", "E"];
  const assignments = makeAssignments(rng, 5, 2);
  const { keys } = affineEncrypt(roster, 2, assignments, rng);

  check(
    "affine keys are plain alphanumerics (no : . -)",
    keys.every((tk) => /^[0-9a-z]+$/.test(tk) && !/[:.\-]/.test(tk))
  );

  let rejected = false;
  const bad = keys[0].slice(0, -1) + (keys[0].slice(-1) === "0" ? "1" : "0");
  try {
    parseToken(bad);
  } catch (e) {
    rejected = true;
  }
  check("corrupted checksum rejected", rejected);

  // Build a checksum-valid token with an unknown tier so the tier check,
  // not the checksum, is what rejects it.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  const body = "z" + "100123";
  const unknownTier = body + (fnv1a(body) % 1296).toString(36).padStart(2, "0");
  let tierRejected = false;
  try {
    parseToken(unknownTier);
  } catch (e) {
    tierRejected = true;
  }
  check("unknown tier rejected", tierRejected);

  // These bodies have valid checksums, so the affine parser (not the
  // checksum) is what must reject them: "a0" has an odd (length-1) payload,
  // "aabc" an odd (length-3) payload.
  const malformed = ["a0", "aabc"].map(
    (b) => b + (fnv1a(b) % 1296).toString(36).padStart(2, "0")
  );
  let msgRejected = true;
  for (const bad of malformed) {
    try {
      parseToken(bad);
      msgRejected = false;
    } catch (e) {
      // expected
    }
  }
  check("checksum-valid but malformed affine token rejected", msgRejected);

  let symbolRejected = false;
  try {
    parseToken("a:0.1.2-00");
  } catch (e) {
    symbolRejected = true;
  }
  check("token containing symbols rejected", symbolRejected);
}

{
  const tok = "pabc123";
  const s = makeShareString("Alice Smith", tok);
  check("share string encodes spaces as underscores", s === "Alice_Smith:" + tok);
  const parsed = parseShareString(s);
  check(
    "share string round-trips name and token",
    parsed && parsed.name === "Alice Smith" && parsed.token === tok
  );
  check("share string returns null without a colon", parseShareString("Alice") === null);
  check(
    "share string rejects empty halves",
    parseShareString(":pabc") === null && parseShareString("Alice:") === null
  );
  const trimmed = parseShareString("  Bob_Jones : pxyz  ");
  check(
    "share string trims surrounding whitespace",
    trimmed && trimmed.name === "Bob Jones" && trimmed.token === "pxyz"
  );
  check("share string returns null for non-strings", parseShareString(null) === null);
  check(
    "encodeName strips forbidden colons/underscores",
    encodeName("A:b_C  D") === "AbC_D"
  );
  check(
    "decodeName turns underscores back into spaces",
    decodeName("Mary_Jane_Watson") === "Mary Jane Watson"
  );
}

{
  const rng = mulberry32(11);
  const roster = ["A", "B", "C", "D"];
  const assignments = makeAssignments(rng, 4, 2);
  const { message } = affineEncrypt(roster, 2, assignments, rng);
  const text = encodeMessage(message);
  const decoded = decodeMessage(text);
  check("affine message encode/decode round-trip", JSON.stringify(decoded) === text);
  let badRejected = false;
  try {
    decodeMessage('{"v":1,"tier":"affine"}');
  } catch (e) {
    badRejected = true;
  }
  check("decodeMessage rejects malformed shape", badRejected);
}

{
  const rng = mulberry32(55);
  const roster = ["A", "B", "C", "D", "E", "F"];
  const assignments = makeAssignments(rng, 6, 2);
  const { message, keys } = affineEncrypt(roster, 2, assignments, rng);
  check(
    "affine message holds one base36 ciphertext per giver",
    message.rows.length === 6 &&
      message.rows.every((c) => typeof c === "string" && /^[0-9a-z]+$/.test(c))
  );
  check("affine key is two short fields", keys.every((tk) => /^a[0-9a-z]+$/.test(tk)));

  const decoded = decodeMessage(encodeMessage(message));
  const r0 = decryptRow(decoded, keys[0]);
  check(
    "affine correct key reveals giver 0's row",
    r0.giver === 0 && eqNums(r0.recipients, assignments[0].slice().sort((a, b) => a - b))
  );

  let wrongOk = false;
  try {
    const r1 = decryptRow(decoded, keys[1]);
    wrongOk = !eqNums(r1.recipients, assignments[0].slice().sort((a, b) => a - b));
  } catch (e) {
    wrongOk = true;
  }
  check("affine wrong key does not reveal giver 0's row", wrongOk);
}

{
  let capped = false;
  try {
    affineModulus(6000, 1);
  } catch (e) {
    capped = true;
  }
  check("affineModulus rejects an over-wide row space 2^n", capped);
}

{
  const n = 181;
  const a = affineModulus(n, 1);
  check("affineModulus supports n=181 (width 36)", a.width === 36);
  const rng = mulberry32(181);
  const roster = [];
  for (let i = 0; i < n; i++) roster.push("P" + i);
  const assignments = makeAssignments(rng, n, 1);
  const { message, keys } = affineEncrypt(roster, 1, assignments, rng);
  let ok = keys.every((tk) => tk.length === 3 + 2 * a.width && /^[0-9a-z]+$/.test(tk));
  for (let i = 0; i < n; i++) {
    const want = assignments[i].slice().sort((x, y) => x - y);
    if (!eqNums(affineDecryptRow(message, keys[i]), want)) ok = false;
  }
  check("affine round-trip n=181 k=1 (width no longer caps at 35)", ok);
}

{
  let ok = true;
  for (const badP of [undefined, null, 0, 1, 1.5, 1e18, 9, true, [], "3"]) {
    const msg = { v: 1, tier: "affine", p: badP, k: 2, roster: ["A", "B", "C", "D"], rows: ["0", "0", "0", "0"] };
    let threw = false;
    try {
      decodeMessage(JSON.stringify(msg));
    } catch (e) {
      threw = true;
    }
    if (!threw) ok = false;
  }
  check("decodeMessage rejects invalid affine modulus (no hang)", ok);

  // The modulus must equal 2^n + 1: 2^n itself is rejected.
  let tooSmall = false;
  try {
    decodeMessage(
      JSON.stringify({
        v: 1,
        tier: "affine",
        p: bigToB36(16n),
        k: 2,
        roster: ["A", "B", "C", "D"],
        rows: ["0", "0", "0", "0"],
      })
    );
  } catch (e) {
    tooSmall = true;
  }
  check("decodeMessage rejects p = 2^n (needs p = 2^n + 1)", tooSmall);

  // Over-long encrypted strings are rejected before parsing (DoS bound).
  let overLong = false;
  try {
    decodeMessage(
      JSON.stringify({
        v: 1,
        tier: "affine",
        p: bigToB36(17n),
        k: 2,
        roster: ["A", "B", "C", "D"],
        rows: ["0", "0", "0", "z".repeat(100000)],
      })
    );
  } catch (e) {
    overLong = true;
  }
  check("decodeMessage rejects an over-long row string", overLong);

  // Correct modulus for n=4 is 2^4+1 = 17 ("h"); a ciphertext outside Z_p is invalid.
  let badCell = false;
  try {
    decodeMessage(
      JSON.stringify({
        v: 1,
        tier: "affine",
        p: bigToB36(17n),
        k: 2,
        roster: ["A", "B", "C", "D"],
        rows: ["0", "1", "2", "h"],
      })
    );
  } catch (e) {
    badCell = true;
  }
  check("decodeMessage rejects a ciphertext >= p", badCell);

  let bigGuard = false;
  try {
    modInverseBig(1n, 1n);
  } catch (e) {
    bigGuard = true;
  }
  check("modInverseBig rejects modulus < 2", bigGuard);
}

console.log("Tier 2 -- ElGamal over Z_p*");

check("PAD_BITS === 64", PAD_BITS === 64);

{
  const rng = mulberry32(99);
  const kp = elgamalKeypair(rng);
  check(
    "elgamal tokens are plain alphanumerics",
    [kp.priv, kp.pub].every((tk) => /^[0-9a-z]+$/.test(tk) && !/[:.\-]/.test(tk))
  );
  check("elgamal private token round-trips", parseToken(kp.priv).fields.x === b36ToBig(kp.priv.slice(1, -2)));
}

for (const shape of [[6, 2], [10, 3]]) {
  const n = shape[0];
  const k = shape[1];
  const rng = mulberry32(2000 + n * 7 + k);
  const roster = [];
  for (let i = 0; i < n; i++) roster.push("Nombre" + i);
  const assignments = makeAssignments(rng, n, k);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push(elgamalKeypair(rng));
  const pubTokens = pairs.map((kp) => kp.pub);
  const { message } = elgamalEncryptRows(roster, k, assignments, pubTokens, rng);

  const text = encodeMessage(message);
  const decoded = decodeMessage(text);

  let ok = true;
  for (let i = 0; i < n; i++) {
    const row = decryptRow(decoded, pairs[i].priv);
    if (row.giver !== i) ok = false;
    if (!eqNums(row.recipients, assignments[i])) ok = false;
    if (!eqNums(row.names, assignments[i].map((r) => roster[r]))) ok = false;
  }
  check("elgamal round-trip n=" + n + " k=" + k, ok);

  const i0 = 0;
  let j = 1;
  while (j < n && eqNums(assignments[j], assignments[i0])) j++;
  let wrongOk = false;
  try {
    const wrongRow = decryptRow(decoded, pairs[j].priv);
    wrongOk = !eqNums(wrongRow.recipients, assignments[i0]);
  } catch (e) {
    wrongOk = true;
  }
  check("wrong private key does not reveal giver " + i0 + "'s row (n=" + n + ")", wrongOk);
}

(async function chunkedTests() {
  const n = 6;
  const k = 2;
  const rng = mulberry32(4242);
  const roster = [];
  for (let i = 0; i < n; i++) roster.push("Chunk" + i);
  const assignments = makeAssignments(rng, n, k);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push(elgamalKeypair(rng));
  const pubTokens = pairs.map((kp) => kp.pub);
  const { message } = await elgamalEncryptRowsChunked(roster, k, assignments, pubTokens, rng);
  const decoded = decodeMessage(encodeMessage(message));
  let ok = true;
  for (let i = 0; i < n; i++) {
    const row = decryptRow(decoded, pairs[i].priv);
    if (row.giver !== i || !eqNums(row.recipients, assignments[i])) ok = false;
  }
  check("elgamal chunked round-trip n=6 k=2", ok);

  console.log("");
  if (failures === 0) {
    console.log("PASS -- all crypto checks passed");
    process.exit(0);
  } else {
    console.log("FAIL -- " + failures + " check(s) failed");
    process.exit(1);
  }
})();
