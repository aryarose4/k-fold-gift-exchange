// Gift Exchange — step-through visualization of the greedy assignment +
// augmenting-path repair from core.js, rendered as an n x n adjacency
// matrix (rows = givers, columns = receivers). Dependency-free ES module;
// reuses makeRng/shuffle from core.js so the walk matches the real solver.
//
// Flow: the matrix renders at full size on load. "Shuffle" permutes the
// rows and swaps itself for "Next step". From then on the current giver's
// legal cells are persistently highlighted green: click one to place a 1
// (the highlights refresh in place for the next pick), or press "Next
// step" to place a random legal pick. When a giver is stuck, the repair
// chain is walked one move at a time, and each "Next step" COMMITS one
// move: the donor's 1 visibly transfers from its old slot to the new
// recipient's cell (the amber donor + arrow + blue target preview the
// move that the next click will apply). The chain's final move gives the
// stuck giver its new edge: no arrow is drawn there (it would originate
// at the row header, i.e. nowhere); instead the free spot it will take
// is highlighted green, and once applied the freshly filled cell stays
// green (resolved) through the reroute beat.
//
// Cell classes: green = allowed (in `options`), red = disallowed
// (self, saturated, or already assigned), amber = donor slot during
// repair, blue = current edge target during repair, green filled =
// newly resolved entry after a repair chain completes.

import { makeRng, shuffle } from "./core.js";

const ALL_NAMES = [
  "Alice", "Bob", "Carlos", "David", "Eve", "Frank",
  "Grace", "Heidi", "Ivan", "Judy",
];

const root = document.getElementById("ge-viz");
if (root) {
  const nSel = root.querySelector("#ge-viz-n");
  const kSel = root.querySelector("#ge-viz-k");
  const nextBtn = root.querySelector("#ge-viz-next");
  const resetBtn = root.querySelector("#ge-viz-reset");
  const shuffleBtn = root.querySelector("#ge-viz-shuffle");
  const status = root.querySelector("#ge-viz-status");
  const matrixBox = root.querySelector("#ge-viz-matrix");

  let N = parseInt(nSel.value, 10);
  const names = () => ALL_NAMES.slice(0, N);

  // Rebuild the k dropdown so its options are exactly 1..n-1 (a valid
  // k-regular digraph needs k <= n-1). Preserves the current selection
  // when still legal, otherwise clamps it to the new maximum.
  function syncKOptions() {
    const maxK = Math.max(1, N - 1);
    const prev = parseInt(kSel.value, 10);
    kSel.replaceChildren();
    for (let k = 1; k <= maxK; k++) {
      const opt = document.createElement("option");
      opt.value = String(k);
      opt.textContent = String(k);
      kSel.appendChild(opt);
    }
    kSel.value = String(Math.min(Number.isNaN(prev) ? maxK : prev, maxK));
  }

  let rng = Math.random;
  let st = null;

  // Persistent DOM: the table is built once per (re)set and then updated
  // in place, so highlight changes animate instead of snapping.
  let cells = null; // cells[i][j]
  let rowHeads = null;
  let svg = null;

  // ---- state construction -------------------------------------------------

  function freshState(prePhase) {
    return {
      k: Math.min(parseInt(kSel.value, 10), N - 1),
      assign: Array.from({ length: N }, () => new Set()),
      cap: null,
      rowNames: names(),
      phase: prePhase, // pre | greedy | repair | reroute | done
      cur: 0, // current giver row index
      opts: [],
      chain: null, // [{h, from, to}] during repair
      ci: 0, // current move index within the chain
      resolved: null, // {h, to} cell freshly filled by the last chain move
    };
  }

  function reset() {
    rng = makeRng((Math.random() * 0xffffffff) >>> 0);
    st = freshState("pre");
    buildTable();
    update();
  }

  function doShuffle() {
    rng = makeRng((Math.random() * 0xffffffff) >>> 0);
    st = freshState("greedy");
    st.rowNames = shuffle(names(), rng);
    st.cap = new Array(N).fill(st.k);
    buildTable();
    enterGiver();
    update();
  }

  const nameOf = (i) => st.rowNames[i];

  // Mirrors options(i) in core.js: not self, has capacity, not already given.
  function optionsOf(i) {
    const out = [];
    for (let j = 0; j < N; j++) {
      if (j !== i && st.cap[j] > 0 && !st.assign[i].has(j)) out.push(j);
    }
    return out;
  }

  function disallowedReason(i, j) {
    if (j === i) return "self";
    if (st.assign[i].has(j)) return "already gives to " + nameOf(j);
    if (st.cap[j] <= 0) return nameOf(j) + " already receives " + st.k;
    return null;
  }

  // Mirrors repair(s) in core.js: BFS over givers to find an augmenting
  // chain, recorded as explicit edge moves for the animation. moves[i] =
  // {h, from, to}: giver h donates the edge h->from and retargets to `to`;
  // the final move (from === null) gives the stuck giver s its new edge.
  function findChain(s) {
    const parent = new Map([[s, null]]);
    const donated = new Map(); // giver -> recipient it donates
    const queue = [];
    for (const r of deficits(s)) {
      for (let h = 0; h < N; h++) {
        if (h !== s && !parent.has(h) && st.assign[h].has(r)) {
          parent.set(h, s);
          donated.set(h, r);
          queue.push(h);
        }
      }
    }
    while (queue.length) {
      const h = queue.shift();
      const opts = optionsOf(h);
      if (opts.length) {
        let take = opts[Math.floor(rng() * opts.length)];
        const moves = [];
        let cur = h;
        while (cur !== null && cur !== s) {
          const give = donated.get(cur);
          moves.push({ h: cur, from: give, to: take });
          take = give;
          cur = parent.get(cur);
        }
        moves.push({ h: s, from: null, to: take });
        return moves;
      }
      for (const r2 of deficits(h)) {
        for (let hh = 0; hh < N; hh++) {
          if (hh !== h && !parent.has(hh) && st.assign[hh].has(r2)) {
            parent.set(hh, h);
            donated.set(hh, r2);
            queue.push(hh);
          }
        }
      }
    }
    return null; // unreachable for k <= n-1 (Hall's condition)
  }

  function deficits(g) {
    const out = [];
    for (let j = 0; j < N; j++) {
      if (j !== g && !st.assign[g].has(j)) out.push(j);
    }
    return out;
  }

  function rowComplete(i) {
    return st.assign[i].size >= st.k;
  }

  // Move to the next giver row, or finish the walk.
  function advanceGiver() {
    if (st.cur >= N - 1) {
      st.phase = "done";
      st.cur = null;
    } else {
      st.cur++;
      enterGiver();
    }
  }

  // Start (or resume) the current giver's turn: highlight its options or
  // enter the repair chain if it is stuck.
  function enterGiver() {
    st.phase = "greedy";
    st.ci = 0;
    st.resolved = null;
    if (rowComplete(st.cur)) {
      advanceGiver();
      return;
    }
    st.opts = optionsOf(st.cur);
    if (!st.opts.length) {
      st.chain = findChain(st.cur);
      st.phase = "repair";
      st.opts = [];
    }
  }

  function place(g, r) {
    st.assign[g].add(r);
    st.cap[r]--;
    if (rowComplete(g)) {
      advanceGiver();
      return;
    }
    st.opts = optionsOf(g);
    // The last placement may have saturated every remaining option, so the
    // giver can become stuck mid-row: enter the repair chain right away.
    if (!st.opts.length) {
      st.chain = findChain(g);
      st.phase = "repair";
    }
  }

  // ---- interactions ---------------------------------------------------------

  function onCell(i, j) {
    if (st.phase !== "greedy" || i !== st.cur || !st.opts.includes(j)) return;
    place(i, j);
    update();
  }

  // ---- one micro-step -------------------------------------------------------

  function step() {
    if (st.phase === "pre" || st.phase === "done") return;
    if (st.phase === "greedy") {
      // Auto-place a random legal pick (same RNG draw as the real solver).
      if (st.opts.length) {
        const r = st.opts[Math.floor(rng() * st.opts.length)];
        place(st.cur, r);
      }
    } else if (st.phase === "repair") {
      // Commit one chain move per click: the donor gives up its old edge
      // and the 1 visibly lands in the new recipient's cell. (Caps are
      // only recomputed once the whole chain has been applied — mid-chain
      // the routing is momentarily over-subscribed, which is exactly what
      // an augmenting path looks like in flight.)
      const m = st.chain[st.ci];
      if (m.from !== null) st.assign[m.h].delete(m.from);
      st.assign[m.h].add(m.to);
      st.resolved = m.from === null ? { h: m.h, to: m.to } : null;
      st.ci++;
      if (st.ci >= st.chain.length) {
        recomputeCaps();
        st.chain = null;
        st.phase = "reroute";
      }
    } else if (st.phase === "reroute") {
      // The repaired giver may now be complete (or need more edges).
      if (rowComplete(st.cur)) advanceGiver();
      else enterGiver();
    }
    update();
  }

  function recomputeCaps() {
    st.cap.fill(st.k);
    for (let i = 0; i < N; i++) for (const j of st.assign[i]) st.cap[j]--;
  }

  // ---- table DOM ------------------------------------------------------------

  function buildTable() {
    const table = document.createElement("table");
    table.className = "ge-mtx";

    const head = document.createElement("tr");
    const corner = cell("th", "gives ↓ / gets →");
    corner.className = "ge-mtx-corner";
    head.appendChild(corner);
    for (let j = 0; j < N; j++) {
      const th = cell("th", st.rowNames[j]);
      th.className = "ge-mtx-col";
      head.appendChild(th);
    }
    table.appendChild(head);

    cells = [];
    rowHeads = [];
    for (let i = 0; i < N; i++) {
      const tr = document.createElement("tr");
      const th = cell("th", st.rowNames[i]);
      th.className = "ge-mtx-row";
      rowHeads.push(th);
      tr.appendChild(th);
      cells.push([]);
      for (let j = 0; j < N; j++) {
        const td = document.createElement("td");
        td.addEventListener("click", () => onCell(i, j));
        cells[i].push(td);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }

    matrixBox.replaceChildren(table);
    removeArrow();
  }

  function cell(tag, text) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  }

  // ---- repair arrow overlay ---------------------------------------------------

  function removeArrow() {
    if (svg) {
      svg.remove();
      svg = null;
    }
  }

  function drawArrow(fromEl, toEl) {
    const rb = matrixBox.getBoundingClientRect();
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const r = a.width / 2;
    let dx = b.left - a.left;
    let dy = b.top - a.top;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const ax = a.left + a.width / 2 - rb.left + dx * (r + 2);
    const ay = a.top + a.height / 2 - rb.top + dy * (r + 2);
    const bx = b.left + b.width / 2 - rb.left - dx * (r + 4);
    const by = b.top + b.height / 2 - rb.top - dy * (r + 4);

    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ge-mtx-arrow");
    svg.setAttribute("width", matrixBox.offsetWidth);
    svg.setAttribute("height", matrixBox.offsetHeight);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", ax);
    line.setAttribute("y1", ay);
    line.setAttribute("x2", bx);
    line.setAttribute("y2", by);
    const headLen = 9;
    const ang = Math.atan2(by - ay, bx - ax);
    const hx = bx - Math.cos(ang) * headLen;
    const hy = by - Math.sin(ang) * headLen;
    const perp = ang + Math.PI / 2;
    const w = 4.5;
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    tip.setAttribute(
      "points",
      [
        [bx, by],
        [hx + Math.cos(perp) * w, hy + Math.sin(perp) * w],
        [hx - Math.cos(perp) * w, hy - Math.sin(perp) * w],
      ]
        .map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1))
        .join(" ")
    );
    svg.appendChild(line);
    svg.appendChild(tip);
    matrixBox.appendChild(svg);
  }

  // ---- status text ------------------------------------------------------------

  function statusText() {
    if (st.phase === "pre") {
      return (
        "Press <strong>Shuffle</strong> to permute the rows; the walk then goes top-down, one micro-step at a time."
      );
    }
    if (st.phase === "done") {
      return (
        "Done: every row and column sums to " + st.k + " with no self-loops — a valid " +
        st.k + "-regular digraph. Press <strong>Reset</strong> to start over."
      );
    }
    const g = st.cur === null ? 0 : st.cur;
    if (st.phase === "greedy") {
      return (
        "Giver <strong>" + nameOf(g) + "</strong> picks a receiver: click a green cell, or press <strong>Next step</strong> for a random legal pick."
      );
    }
    if (st.phase === "repair") {
      return (
        "Dead end: <strong>" + nameOf(g) + "</strong> has no legal options, so the repair chain reroutes 1s — each <strong>Next step</strong> moves an amber donor's 1 to the blue target, and the last move gives <strong>" +
        nameOf(g) + "</strong> a new edge."
      );
    }
    if (st.phase === "reroute") {
      return "Chain rerouted: <strong>" + nameOf(g) + "</strong> gains an edge; everyone else swapped one for another.";
    }
    return "";
  }

  // ---- rendering (in-place updates so highlights animate) ----------------------

  function update() {
    removeArrow();
    for (let i = 0; i < N; i++) {
      const active =
        st.phase !== "pre" && st.phase !== "done" && st.phase !== "repair" &&
        i === st.cur;
      rowHeads[i].classList.toggle("ge-mtx-active", active);
      for (let j = 0; j < N; j++) {
        const td = cells[i][j];
        td.className = "";
        td.title = "";
        td.textContent = st.assign[i].has(j) ? "1" : "";
      }
    }

    if (st.phase === "greedy") {
      const g = st.cur;
      const optsSet = new Set(st.opts);
      for (let j = 0; j < N; j++) {
        if (st.assign[g].has(j)) continue;
        if (optsSet.has(j)) {
          cells[g][j].classList.add("ge-mtx-allowed");
        } else {
          cells[g][j].classList.add("ge-mtx-banned");
          cells[g][j].title = "Disallowed: " + disallowedReason(g, j);
        }
      }
    } else if (st.phase === "repair" && st.chain) {
      const m = st.chain[st.ci];
      rowHeads[m.h].classList.add("ge-mtx-active");
      if (m.from !== null) {
        // Preview of the move the next click will commit: amber donor,
        // arrow to the blue target. Exactly one blue cell at a time.
        cells[m.h][m.from].classList.add("ge-mtx-donor");
        cells[m.h][m.to].classList.add("ge-mtx-target");
        drawArrow(cells[m.h][m.from], cells[m.h][m.to]);
      } else {
        // Final move: the stuck giver gains its edge. No arrow here — it
        // would originate at the row header (nowhere) — and no blue
        // target; instead the free spot it is about to take is
        // highlighted green, and the cell stays green once committed.
        cells[m.h][m.to].classList.add("ge-mtx-allowed");
      }
    }
    if (st.resolved) {
      // The chain's last move just landed: keep the freshly resolved
      // entry highlighted green through the reroute beat.
      cells[st.resolved.h][st.resolved.to].classList.add("ge-mtx-resolved");
    }

    status.innerHTML = statusText();
    shuffleBtn.hidden = st.phase !== "pre";
    nextBtn.hidden = st.phase === "pre";
    nextBtn.disabled = st.phase === "done";
  }

  nextBtn.addEventListener("click", step);
  resetBtn.addEventListener("click", reset);
  shuffleBtn.addEventListener("click", doShuffle);
  nSel.addEventListener("change", () => {
    N = parseInt(nSel.value, 10);
    // Rebuild k's options to 1..n-1 so an illegal k can't be selected.
    syncKOptions();
    reset();
  });
  kSel.addEventListener("change", reset);
  syncKOptions();
  reset();
}
