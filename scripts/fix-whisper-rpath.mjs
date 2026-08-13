/**
 * @kutalia/whisper-node-addon ships prebuilt mac binaries whose LC_RPATH is
 * hardcoded to the CI runner's build path, so the .node can't find the
 * libwhisper/libggml dylibs sitting right next to it. Add `@loader_path` as an
 * rpath so dlopen resolves them relative to the binary. Idempotent; runs on
 * every `npm install` via the postinstall hook.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const root = dirname(fileURLToPath(import.meta.url));
const addon = join(
	root,
	"..",
	"node_modules",
	"@kutalia",
	"whisper-node-addon",
	"dist",
	`mac-${process.arch}`,
	"whisper.node",
);

if (!existsSync(addon)) process.exit(0);

const rpaths = execFileSync("otool", ["-l", addon], { encoding: "utf8" });
if (rpaths.includes("@loader_path")) process.exit(0);

execFileSync("install_name_tool", ["-add_rpath", "@loader_path", addon]);
console.log(`[fix-whisper-rpath] added @loader_path rpath to ${addon}`);
