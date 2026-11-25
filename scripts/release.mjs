// Bump the version, build a new installer and put it in <project>/releases. The running buddy
// notices it within ~2 minutes and offers an "Update" button (see src/services/update.ts).
//   npm run release            → 1.0.0 → 1.0.1
//   npm run release -- minor   → 1.0.1 → 1.1.0
//   npm run release -- 2.0.0   → exact version
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

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

// Cargo may keep its build cache anywhere (see src-tauri/.cargo/config.toml); ask it where.
const targetDir = JSON.parse(execSync("cargo metadata --format-version 1 --no-deps", { cwd: "src-tauri", encoding: "utf8" })).target_directory;
const name = `Deskbud_${next}_x64-setup.exe`;
const built = join(targetDir, "release", "bundle", "nsis", name);

const put = (dir) => { mkdirSync(dir, { recursive: true }); copyFileSync(built, join(dir, name)); };
put("releases");
// Transition: builds up to v1.0.2 look in the old in-project bundle folder. Harmless to keep.
put("src-tauri/target/release/bundle/nsis");

// Keep the 3 newest installers.
const vkey = (f) => f.match(/_(\d+)\.(\d+)\.(\d+)_/)?.slice(1).map(Number) ?? [0, 0, 0];
const olds = readdirSync("releases").filter((f) => f.endsWith("-setup.exe"))
  .sort((a, b) => { const x = vkey(a), y = vkey(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; }).slice(3);
for (const f of olds) rmSync(join("releases", f));

console.log(`\n✓ Built v${next} → releases\\${name}\n  Your buddy will offer the update within ~2 minutes (or tray → Check for updates).\n`);
