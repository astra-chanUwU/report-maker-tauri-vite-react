#!/usr/bin/env node
// Generate a valid v1 RM-XXXX-XXXX-XXXX key (checksum mod 36 == 0).
// Usage: node scripts/gen-license.mjs [prefix-with-XXXX]
// Example: node scripts/gen-license.mjs RM-TEST-0000-XXXX  -> brute-forces last 4
const ALPH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function val(c) {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  return code - 55;
}
function sumPayload(payload) {
  let s = 0;
  for (const c of payload) s += val(c);
  return s;
}
function format(payload) {
  return `RM-${payload.slice(0, 4)}-${payload.slice(4, 8)}-${payload.slice(8, 12)}`;
}
function randomPayload() {
  let p = "";
  for (let i = 0; i < 12; i++) p += ALPH[Math.floor(Math.random() * 36)];
  return p;
}
function bruteForce(template) {
  const upper = template.toUpperCase();
  if (!upper.startsWith("RM-")) throw new Error("template must start with RM-");
  const payloadTemplate = upper.slice(3).replace(/-/g, "");
  if (payloadTemplate.length !== 12) throw new Error("payload must be 12 chars with X as wildcard");
  const fixed = [...payloadTemplate];
  const wild = fixed.map((c, i) => (c === "X" ? i : -1)).filter((i) => i !== -1);
  if (wild.length === 0) {
    if (sumPayload(payloadTemplate) % 36 !== 0) throw new Error("provided key fails checksum");
    return format(payloadTemplate);
  }
  if (wild.length > 6) throw new Error("too many wildcards (max 6 for brute force)");
  const total = Math.pow(36, wild.length);
  for (let n = 0; n < total; n++) {
    let tmp = [...fixed];
    let v = n;
    for (const idx of wild) {
      tmp[idx] = ALPH[v % 36];
      v = Math.floor(v / 36);
    }
    const payload = tmp.join("");
    if (sumPayload(payload) % 36 === 0) return format(payload);
  }
  throw new Error("no valid key found within search space");
}

const arg = process.argv[2];
if (arg && arg.includes("X")) {
  console.log(bruteForce(arg));
} else if (arg) {
  const payload = arg
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12)
    .padEnd(12, "0");
  // try to fix checksum by tweaking last char
  let base = payload.slice(0, 11);
  for (const c of ALPH) {
    const cand = base + c;
    if (sumPayload(cand) % 36 === 0) {
      console.log(format(cand));
      process.exit(0);
    }
  }
  // fallback brute force last char already
  let p = randomPayload();
  let tries = 0;
  while (sumPayload(p) % 36 !== 0 && tries < 10000) {
    p = randomPayload();
    tries++;
  }
  console.log(format(p));
} else {
  let p = randomPayload();
  let tries = 0;
  while (sumPayload(p) % 36 !== 0 && tries < 10000) {
    p = randomPayload();
    tries++;
  }
  console.log(format(p));
}
