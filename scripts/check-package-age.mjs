#!/usr/bin/env node

/**
 * Checks that all direct dependencies were published at least N days ago.
 * Defends against supply-chain attacks where a compromised version is published
 * and immediately consumed by CI.
 *
 * Usage: node scripts/check-package-age.mjs [--min-days=7] [--dir=.]
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";

const args = process.argv.slice(2);
const minDays = parseInt(
  args.find((a) => a.startsWith("--min-days="))?.split("=")[1] ?? "7",
  10
);
const dir = resolve(
  args.find((a) => a.startsWith("--dir="))?.split("=")[1] ?? "."
);

const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
const allDeps = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
};

const now = Date.now();
const minAge = minDays * 24 * 60 * 60 * 1000;
const failures = [];
const checked = [];

for (const [name, version] of Object.entries(allDeps)) {
  // Strip any remaining range prefixes (shouldn't exist if pinned, but be safe)
  const exactVersion = version.replace(/^[\^~>=<]*/g, "");

  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${exactVersion}`
    );
    if (!res.ok) {
      // Package might be scoped or not on public registry
      console.warn(`  SKIP ${name}@${exactVersion} (HTTP ${res.status})`);
      continue;
    }

    const data = await res.json();

    // Get publish time from the dist-tags or time field
    // Individual version endpoint doesn't always have time, fetch full metadata
    const metaRes = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`
    );
    const meta = await metaRes.json();
    const publishTime = meta.time?.[exactVersion];

    if (!publishTime) {
      console.warn(`  SKIP ${name}@${exactVersion} (no publish time found)`);
      continue;
    }

    const publishDate = new Date(publishTime);
    const ageMs = now - publishDate.getTime();
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (ageMs < minAge) {
      failures.push({
        name,
        version: exactVersion,
        published: publishDate.toISOString().split("T")[0],
        ageDays,
      });
      console.error(
        `  FAIL ${name}@${exactVersion} published ${ageDays}d ago (${publishDate.toISOString().split("T")[0]}), minimum ${minDays}d`
      );
    } else {
      checked.push({ name, version: exactVersion, ageDays });
    }
  } catch (err) {
    console.warn(`  SKIP ${name}@${exactVersion} (${err.message})`);
  }
}

console.log(
  `\nChecked ${checked.length + failures.length} packages (min age: ${minDays} days)`
);

if (failures.length > 0) {
  console.error(
    `\n${failures.length} package(s) younger than ${minDays} days:`
  );
  for (const f of failures) {
    console.error(`  ${f.name}@${f.version} (${f.ageDays}d old)`);
  }
  process.exit(1);
} else {
  console.log("All packages meet minimum age requirement.");
}
