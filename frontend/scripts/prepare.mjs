import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = path.join(root, "frontend");
const destination = path.join(frontend, "public");
const dist = path.join(frontend, "dist");
await mkdir(destination, { recursive: true });
for (const name of ["price-model.onnx", "report.json", "parity.json"])
  for (const target of [destination, dist])
    await copyFile(
      path.join(root, "src/airbnb_price/artifacts", name),
      path.join(target, name),
    );
for (const name of ["LICENSE", "NOTICE.md"])
  for (const target of [destination, dist])
    await copyFile(path.join(root, name), path.join(target, name));
const bundled = JSON.parse(
  await readFile(path.join(dist, "bundled-packages.json"), "utf8"),
);
if (
  !Array.isArray(bundled) ||
  !bundled.every(
    (name) => typeof name === "string" && /^(?:@[\w.-]+\/)?[\w.-]+$/.test(name),
  )
)
  throw new Error("Invalid bundled package manifest");
const records = [];
const visited = new Set();
async function visit(name, parent) {
  let cursor = parent,
    folder;
  while (true) {
    const candidate = path.join(cursor, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) {
      folder = candidate;
      break;
    }
    const next = path.dirname(cursor);
    if (next === cursor) throw new Error(`Missing production package ${name}`);
    cursor = next;
  }
  if (visited.has(folder)) return;
  visited.add(folder);
  const metadata = JSON.parse(
    await readFile(path.join(folder, "package.json"), "utf8"),
  );
  let legalFolder = folder;
  let files = (await readdir(folder)).filter((file) =>
    /^(license|notice|copying|ofl|thirdpartynotices)([.-]|$)/i.test(file),
  );
  if (
    !files.length &&
    ["onnxruntime-web", "onnxruntime-common"].includes(metadata.name) &&
    metadata.version === "1.30.0"
  ) {
    legalFolder = path.join(frontend, "legal");
    files = ["onnxruntime-LICENSE.txt", "onnxruntime-ThirdPartyNotices.txt"];
  }
  if (!files.length) throw new Error(`Missing production license for ${name}`);
  records.push({
    name: metadata.name,
    version: metadata.version,
    license: metadata.license,
    notices: await Promise.all(
      files.map(async (file) => ({
        file,
        text: await readFile(path.join(legalFolder, file), "utf8"),
      })),
    ),
  });
}
for (const name of bundled) await visit(name, frontend);
records.push({
  name: "NYC Top of the Rock Pano.jpg",
  creator: "Daniel Schwen",
  license: "CC BY-SA 3.0",
  licenseURL: "https://creativecommons.org/licenses/by-sa/3.0/",
  source:
    "https://commons.wikimedia.org/wiki/File:NYC_Top_of_the_Rock_Pano.jpg",
  modifications:
    "Wikimedia thumbnail resizing and responsive display cropping; photo/crop remains CC BY-SA 3.0.",
});
for (const target of [destination, dist])
  await writeFile(
    path.join(target, "licenses.json"),
    JSON.stringify(records, null, 2) + "\n",
  );
console.log(
  `Prepared model/report and ${records.length} production dependency/photo notice records.`,
);
