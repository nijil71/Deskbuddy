// Bump the version and build a new installer. The running buddy notices it within ~2 minutes
// and offers an "Update" button (see src/services/update.ts).
//   npm run release            → 1.0.0 → 1.0.1
//   npm run release -- minor   → 1.0.1 → 1.1.0
//   npm run release -- 2.0.0   → exact version
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const conf = "src-tauri/tauri.conf.json";
const cur = JSON.parse(readFileSync(conf, "utf8")).version;
const [ma, mi, pa] = cur.split(".").map(Number);
const arg = process.argv[2] ?? "patch";
const next =
  arg === "patch" ? `${ma}.${mi}.${pa + 1}` :
  arg === "minor" ? `${ma}.${mi + 1}.0` :
  arg === "major" ? `${ma + 1}.0.0` :
  /^\d+\.\d+\.\d+$/.test(arg) ? arg : null;
if (!next) { console.error("usage: npm run release [-- patch|minor|major|x.y.z]"); process.exit(1); }

const edit = (file, re) => {
  const s = readFileSync(file, "utf8");
  if (!re.test(s)) throw new Error(`version not found in ${file}`);
  writeFileSync(file, s.replace(re, `$1${next}"`));
};
edit("package.json", /("version":\s*")[^"]+"/);
edit(conf, /("version":\s*")[^"]+"/);
edit("src-tauri/Cargo.toml", /^(version\s*=\s*")[^"]+"/m);
console.log(`\nDeskbud ${cur} → ${next}, building installer…\n`);

execSync("npx tauri build --bundles nsis", { stdio: "inherit" });
console.log(`\n✓ Built v${next}. Your buddy will offer the update within ~2 minutes (or tray → Check for updates).\n`);
