// audit gate: fail on high/critical vulns like `npm audit --audit-level=high`,
// but allow specific GHSA ids that are documented as unfixable-pending-upstream.
// usage: node scripts/audit-gate.mjs --dir=. --allow=GHSA-xxxx-xxxx-xxxx,GHSA-...
import { execSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const dir = args.dir || '.';
const allow = new Set((args.allow || '').split(',').filter(Boolean));

let report;
try {
  report = JSON.parse(execSync('npm audit --json', { cwd: dir, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }));
} catch (err) {
  // npm audit exits non-zero when vulns exist; stdout still has the json
  if (!err.stdout) { console.error('npm audit failed:', err.message); process.exit(2); }
  report = JSON.parse(err.stdout);
}

const failures = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities || {})) {
  if (vuln.severity !== 'high' && vuln.severity !== 'critical') continue;
  // direct advisories on this package (dicts in `via`); chains (strings) are pulled in by their leaf advisory
  const advisories = vuln.via.filter(v => typeof v === 'object');
  const ghsaOf = (adv) => (adv.url || '').split('/').pop();
  const blocking = advisories.filter(adv => !allow.has(ghsaOf(adv)));
  if (advisories.length > 0 && blocking.length === 0) continue; // all advisories allowlisted
  if (advisories.length === 0) {
    // chain-only entry: vulnerable via another package; that package's own entry decides
    continue;
  }
  for (const adv of blocking) {
    failures.push(`${vuln.severity} ${name}: ${adv.title} (${ghsaOf(adv)})`);
  }
}

if (failures.length > 0) {
  console.error(`audit gate FAILED for ${dir}:`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}

const allowed = allow.size > 0 ? ` (allowlisted: ${[...allow].join(', ')})` : '';
console.log(`audit gate passed for ${dir}${allowed}`);
