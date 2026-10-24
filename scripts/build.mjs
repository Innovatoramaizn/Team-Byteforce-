// Copies the deployable front end into dist/ so only public files are uploaded:
// index.html, src/*.js, src/styles.css and assets/.
// Run with: npm run build
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const entry of ["index.html", "src", "assets"]) {
  const from = join(root, entry);
  if (!existsSync(from)) {
    console.error("missing:", entry);
    process.exit(1);
  }
  cpSync(from, join(dist, entry), { recursive: true });
}

console.log("built dist/ (index.html, src/, assets/)");
