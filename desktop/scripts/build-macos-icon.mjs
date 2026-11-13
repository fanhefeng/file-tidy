import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("Regenerating the ICNS asset requires macOS sips and iconutil.");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "resources/icon-macos.png");
const output = path.join(root, "resources/icon.icns");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "file-tidy-icon-"));
const iconset = path.join(temporary, "FileTidy.iconset");
try {
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
      execFileSync("sips", ["-z", pixels, pixels, source, "--out", path.join(iconset, name)], { stdio: "ignore" });
    }
  }
  execFileSync("iconutil", ["--convert", "icns", iconset, "--output", output], { stdio: "inherit" });
  console.log(`Created ${output}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
