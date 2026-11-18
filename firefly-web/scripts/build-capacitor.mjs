import { execSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const apiDir = path.join(rootDir, "src", "app", "api");
const apiBackupDir = path.join(rootDir, ".capacitor-api-backup");
const nextDir = path.join(rootDir, ".next");
const outDir = path.join(rootDir, "out");

function restoreApiDir() {
  if (existsSync(apiBackupDir) && !existsSync(apiDir)) {
    renameSync(apiBackupDir, apiDir);
  }
}

// Recover gracefully if a previous interrupted build left the backup directory behind
restoreApiDir();

try {
  if (existsSync(apiDir)) {
    if (existsSync(apiBackupDir)) {
      rmSync(apiBackupDir, { recursive: true, force: true });
    }
    renameSync(apiDir, apiBackupDir);
  }

  // Clear stale .next/types & .next/dev/types referencing /api routes before static export
  rmSync(path.join(nextDir, "types"), { recursive: true, force: true });
  rmSync(path.join(nextDir, "dev", "types"), { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });

  execSync("npx next build", {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      CAPACITOR_EXPORT: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  const requiredPages = [
    "index.html",
    path.join("login", "index.html"),
    path.join("categories", "index.html"),
    path.join("new", "index.html"),
    path.join("accounts", "index.html"),
    path.join("accounts", "detail", "index.html"),
    path.join("budgets", "index.html"),
    path.join("transactions", "index.html"),
    path.join("reports", "index.html"),
    path.join("settings", "index.html"),
  ];

  for (const rel of requiredPages) {
    const target = path.join(outDir, rel);
    if (!existsSync(target)) {
      throw new Error(`Missing expected static Capacitor export page: out/${rel}`);
    }
  }

  console.log("Verified static Capacitor export bundle in firefly-web/out/");
} finally {
  restoreApiDir();
}
