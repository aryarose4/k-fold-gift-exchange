// Gift Exchange: k Secret k Santa — standalone decrypt page.
// Handles the reveal panel only; the generator lives in app.js on the
// project page. ES module importing ./crypto.js. No frameworks, no deps.

import { decryptRow, decodeMessage } from "./crypto.js";

const $ = (id) => document.getElementById(id);

function revealMessage() {
  const msgText = $("ge-reveal-message").value.trim();
  const key = $("ge-reveal-key").value.trim();
  const errEl = $("ge-reveal-error");
  errEl.textContent = "";
  $("ge-reveal-out").innerHTML = "";

  let msg;
  try {
    msg = decodeMessage(msgText);
  } catch (e) {
    errEl.textContent = "That doesn't look like a valid gift-exchange message.";
    return;
  }

  if (!key) {
    errEl.textContent = "Enter your private key.";
    return;
  }

  let dec;
  try {
    dec = decryptRow(msg, key);
  } catch (e) {
    errEl.textContent = "Could not decrypt. Check that your key was copied exactly.";
    return;
  }
  showReveal(msg, dec);
}

function showReveal(msg, dec) {
  const host = $("ge-reveal-out");
  host.innerHTML = "";
  const giverName = msg.roster[dec.giver] || "You";

  const p = document.createElement("p");
  p.className = "ge-reveal-result";
  const strong = document.createElement("strong");
  strong.textContent = giverName;
  p.appendChild(strong);
  p.appendChild(document.createTextNode(" gives a gift to: "));
  const rec = document.createElement("strong");
  rec.textContent = dec.names.join(", ");
  p.appendChild(rec);
  p.appendChild(document.createTextNode("."));
  host.appendChild(p);
}

function handleHash() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  if (!params.has("ge")) return;
  $("ge-reveal-message").value = params.get("ge");
  if (params.has("k")) $("ge-reveal-key").value = params.get("k");
  revealMessage();
  const app = $("ge-reveal-app");
  if (app && app.scrollIntoView) app.scrollIntoView({ block: "start" });
}

export function activate() {
  const go = $("ge-reveal-go");
  if (!go) return;
  go.addEventListener("click", revealMessage);
  window.addEventListener("hashchange", handleHash);
  handleHash();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", activate);
} else {
  activate();
}