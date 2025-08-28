import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = ".";
const srcDir = path.join(projectRoot, "src");
const outFile = path.join(projectRoot, "combined_sources_jsx.txt");
const exts = new Set([".jsx"]);

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (exts.has(path.extname(entry.name).toLowerCase())) yield p;
  }
}

await fs.writeFile(outFile, "", "utf8");
for await (const file of walk(srcDir)) {
  const rel = path.relative(projectRoot, file);
  const body = await fs.readFile(file, "utf8");
  await fs.appendFile(outFile, `\n===== BEGIN ${rel} =====\n${body}\n`);
}
console.log("Wrote:", outFile);
