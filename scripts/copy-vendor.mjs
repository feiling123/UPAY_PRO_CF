import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const vendorFiles = [
  {
    from: "node_modules/qrcode-generator/qrcode.js",
    to: "public/vendor/qrcode.js"
  }
];

for (const file of vendorFiles) {
  const target = resolve(file.to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(file.from), target);
}
