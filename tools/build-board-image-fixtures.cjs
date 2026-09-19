"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const sharp = require("sharp");

async function main() {
  const input = process.argv[2];
  const profile = process.argv[3] || "reference";
  if (!input || !["reference", "teaching-sign"].includes(profile)) throw new Error("Pass a chart PNG and optionally the teaching-sign profile.");
  const crop = profile === "reference" ? { left: 29, top: 73, width: 1021, height: 1021 }
    : { left: 24, top: 65, width: 1032, height: 1032 };
  const dir = path.join(__dirname, "../tests/fixtures/board-image", profile === "reference" ? "" : profile);
  fs.mkdirSync(dir, { recursive: true });
  const variants = [
    ["reference", () => sharp(input)],
    ["jpeg-small", async () => sharp(await sharp(input).resize({ width: 810 }).jpeg({ quality: 70 }).toBuffer())],
    ["half-size", () => sharp(input).resize({ width: 540 })],
    ["padded", () => sharp(input).extend({ top: 37, bottom: 61, left: 53, right: 79, background: "#fff" })],
    ["cropped", () => sharp(input).extract(crop)],
  ];
  const manifest = [];
  for (const [name, factory] of variants) {
    const pipeline = await factory();
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    fs.writeFileSync(path.join(dir, `${name}.rgba.gz`), zlib.gzipSync(data, { level: 9 }));
    manifest.push({ name, width: info.width, height: info.height });
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
