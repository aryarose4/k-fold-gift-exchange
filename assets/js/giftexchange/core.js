// Gift Exchange: k Secret k Santa — core assignment engine.
// Dependency-free ES module, browser + Node compatible.
//
// Problem: assign each of n participants k distinct recipients (no
// self-gifts) such that every participant receives from exactly k
// distinct givers — a random k-regular directed graph without loops.
// A solution exists for every 1 <= k <= n-1 (Gale-Ryser / Hall on the
// bipartite giver->recipient graph with the diagonal forbidden).
//
// Algorithm: randomized greedy matching with augmenting-path repair.
// Givers are processed in random order; each picks k distinct random
// recipients among those with remaining capacity. If a giver gets
// stuck (all allowed recipients are full or already theirs), a BFS
// augmenting path reroutes existing edges: a chain of givers each
// donates one edge and takes a free alternative, completing the
// assignment WITHOUT any reject-and-retry loop. Completeness follows
// from Hall's condition, which always holds for k <= n-1.
//
// Randomness quality: greedy-with-repair is not exactly uniform over
// all k-regular digraphs (exact uniformity would need switch-chain
// MCMC — unnecessary here), but random processing order + random
// recipient choice gives an unbiased-feeling draw for party use.
// A seeded RNG makes draws reproducible.

/** Deterministic PRNG (mulberry32). Returns () => float in [0,1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomInt = (rng, m) => Math.floor(rng() * m);

/** Fisher-Yates shuffle (in place), rng-injectable. */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/**
 * Generate the assignment.
 * @param {string[]} names participant list (n >= 2, no duplicates)
 * @param {number} k gifts per person, 1 <= k <= n-1
 * @param {function} [rng] PRNG; default Math.random-backed
 * @returns {{names: string[], k: number, assignments: number[][]}}
 *   assignments[i] = sorted list of the k recipient indices person i gives to.
 */
export function generateAssignment(names, k, rng = Math.random) {
  const n = names.length;
  if (!Number.isInteger(n) || n < 2) {
    throw new Error("Need at least 2 participants.");
  }
  if (!Number.isInteger(k) || k < 1 || k > n - 1) {
    throw new Error("k must be an integer in [1, n-1] (n = " + n + ").");
  }
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Participant names must be non-empty.");
    }
    const key = name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new Error("Duplicate participant name: " + name.trim());
    }
    seen.add(key);
  }

  // assign[i]: Set of recipient indices; cap[j]: remaining in-degree slots.
  const assign = [];
  for (let i = 0; i < n; i++) assign.push(new Set());
  const cap = new Array(n).fill(k);

  // Allowed recipients for giver i: not self, capacity left, not already given.
  function options(i) {
    const out = [];
    for (let j = 0; j < n; j++) {
      if (j !== i && cap[j] > 0 && !assign[i].has(j)) out.push(j);
    }
    return out;
  }

  // Deficits of giver g: recipients it still owes (not self, not given).
  function deficits(g) {
    const out = [];
    for (let j = 0; j < n; j++) {
      if (j !== g && !assign[g].has(j)) out.push(j);
    }
    return out;
  }

  function recomputeCaps() {
    cap.fill(0);
    for (let i = 0; i < n; i++) for (const j of assign[i]) cap[j]++;
    for (let j = 0; j < n; j++) cap[j] = k - cap[j];
  }

  // Augmenting-path repair for stuck giver s (options(s) is empty, so
  // every deficit of s is a FULL recipient). BFS over givers: s wants a
  // deficit r1; h1 holds r1; if h1 has any free option it donates r1 and
  // takes that; otherwise h1 wants a deficit r2 of its own, held by h2,
  // and so on. A terminal giver with free options reroutes the whole
  // chain: each h_i donates r_i and takes r_{i+1} (a deficit of h_i, so
  // never already assigned to h_i), and s finally takes r1. Every edge
  // move preserves all in/out degrees except s gaining one.
  function repair(s) {
    const parent = new Map(); // giver -> giver whose deficit it donates to
    const donated = new Map(); // giver -> recipient it will donate
    parent.set(s, null);
    const queue = [];
    const seedHolders = [];
    for (const r of deficits(s)) {
      for (let h = 0; h < n; h++) {
        if (h !== s && !parent.has(h) && assign[h].has(r)) {
          parent.set(h, s);
          donated.set(h, r);
          seedHolders.push(h);
        }
      }
    }
    queue.push(...seedHolders);
    while (queue.length) {
      const h = queue.shift();
      const opts = options(h);
      if (opts.length) {
        let take = opts[randomInt(rng, opts.length)];
        let cur = h;
        while (cur !== null && cur !== s) {
          const give = donated.get(cur);
          assign[cur].delete(give);
          assign[cur].add(take);
          take = give;
          cur = parent.get(cur);
        }
        assign[s].add(take);
        recomputeCaps();
        return true;
      }
      for (const r2 of deficits(h)) {
        for (let hh = 0; hh < n; hh++) {
          if (hh !== h && !parent.has(hh) && assign[hh].has(r2)) {
            parent.set(hh, h);
            donated.set(hh, r2);
            queue.push(hh);
          }
        }
      }
    }
    return false; // unreachable for k <= n-1 (Hall's condition)
  }

  // Greedy pass in random giver order; repair on stall.
  const order = shuffle([...Array(n).keys()], rng);
  for (const i of order) {
    while (assign[i].size < k) {
      const opts = options(i);
      if (!opts.length) {
        if (!repair(i)) {
          throw new Error("Internal error: assignment search failed.");
        }
      } else {
        const j = opts[randomInt(rng, opts.length)];
        assign[i].add(j);
        cap[j]--;
      }
    }
  }

  return {
    names: names.map((s) => s.trim()),
    k,
    assignments: assign.map((set) => [...set].sort((a, b) => a - b)),
  };
}

/** Validate invariants: exact out-degree k, in-degree k, no self-loops. */
export function validateAssignment(result) {
  const { names, k, assignments } = result;
  const n = names.length;
  if (assignments.length !== n) return false;
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const row = assignments[i];
    if (row.length !== k) return false;
    const uniq = new Set(row);
    if (uniq.size !== k) return false;
    if (uniq.has(i)) return false;
    for (const j of row) {
      if (j < 0 || j >= n) return false;
      indeg[j]++;
    }
  }
  return indeg.every((d) => d === k);
}
