// Gift Exchange: k Secret k Santa — standalone keypair generator page.
// Used only for Secret Mode (Double Blind). ES module importing ./crypto.js.
// No frameworks, no deps.

import { elgamalKeypair, makeShareString } from "./crypto.js";

const $ = (id) => document.getElementById(id);

async function copyText(text, okMsg) {
  const status = $("ge-keygen-status");
  try {
    await navigator.clipboard.writeText(text);
    if (status) {
      status.textContent = okMsg;
      setTimeout(() => (status.textContent = ""), 3000);
    }
  } catch (e) {
    if (status) status.textContent = "Copy failed — select the key and copy it manually.";
  }
}

function makeKeypair() {
  const name = $("ge-keygen-name").value.trim();
  const status = $("ge-keygen-status");
  if (!name) {
    status.textContent = "Enter your full name first.";
    return;
  }
  const { priv, pub } = elgamalKeypair();
  $("ge-keygen-share").textContent = makeShareString(name, pub);
  $("ge-keygen-priv").textContent = priv;
  $("ge-keygen-out").style.display = "";
  status.textContent = "Key created. Copy and save it — it is not stored in this browser.";
}

// The share line is "Name:PublicKey", so the name may not contain `:` (the
// separator) or `_` (which stands in for spaces).
function sanitizeName() {
  const el = $("ge-keygen-name");
  const cleaned = el.value.replace(/[:_]/g, "");
  if (cleaned !== el.value) el.value = cleaned;
}

export function activate() {
  const make = $("ge-keygen-make");
  if (!make) return;
  $("ge-keygen-name").addEventListener("input", sanitizeName);
  make.addEventListener("click", makeKeypair);
  $("ge-keygen-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      makeKeypair();
    }
  });
  $("ge-keygen-copy-share").addEventListener("click", () =>
    copyText($("ge-keygen-share").textContent, "Copied.")
  );
  $("ge-keygen-copy-priv").addEventListener("click", () =>
    copyText($("ge-keygen-priv").textContent, "Copied.")
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", activate);
} else {
  activate();
}