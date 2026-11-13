import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const root = dirname(fileURLToPath(import.meta.url));
const helper = join(
	root,
	"..",
	"node_modules",
	"node-pty",
	"prebuilds",
	`darwin-${process.arch}`,
	"spawn-helper",
);

if (existsSync(helper)) chmodSync(helper, 0o755);
