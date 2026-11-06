#!/usr/bin/env node
// Pre-commit secret gate. Blocks staged secret-bearing files and runs gitleaks over the
// staged diff; falls back to a pattern + high-entropy scan when gitleaks is not installed.
// Exit 0 = clear, 1 = blocked. See docs/PLAN.md section 12.
import { spawnSync } from 'node:child_process';

const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
};

const BLOCKED = [
  /(^|\/)\.env$/i,
  /(^|\/)\.env\.(?!example)/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)(\.\w+)?$/i,
  /\.local$/i,
  /(^|\/)(cookies?|credentials?|secrets?)(\.\w+)?$/i,
];

const PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/\bASIA[0-9A-Z]{16}\b/, 'AWS temporary access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'GitHub fine-grained token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/, 'Google API key'],
  [/\bsk-(?:live|test|proj|pat)-[A-Za-z0-9_-]{16,}\b/, 'Stripe/OpenAI-style secret key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/, 'JWT'],
  [/(password|passwd|secret|token|api[_-]?key|access[_-]?key|credential)s?\s*[:=]\s*['"]?[^\s'"]{6,}/i, 'hardcoded credential assignment'],
];

const stagedFiles = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);

const problems = [];
for (const file of stagedFiles) {
  const hit = BLOCKED.find((re) => re.test(file));
  if (hit) problems.push(`blocked file staged: ${file} (pattern ${hit})`);
}

const gitleaks = spawnSync('gitleaks', ['protect', '--staged', '--no-banner', '--redact'], {
  encoding: 'utf8',
});
if (gitleaks.error?.code === 'ENOENT') {
  console.warn('precommit-scan: gitleaks not on PATH, using pattern + entropy fallback');
  const diff = git(['diff', '--cached', '--unified=0']);
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const body = line.slice(1);
    for (const [re, label] of PATTERNS) {
      if (re.test(body)) problems.push(`${label}: ${body.slice(0, 120)}`);
    }
    for (const blob of body.match(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g) ?? []) {
      const uniq = new Set(blob).size / blob.length;
      if (uniq > 0.55) problems.push(`high-entropy string: ${blob.slice(0, 80)}`);
    }
  }
} else if (gitleaks.status !== 0) {
  problems.push(`gitleaks reported findings:\n${gitleaks.stdout}${gitleaks.stderr}`);
}

if (problems.length > 0) {
  console.error(`\nprecommit-scan: BLOCKED (${problems.length})`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nNothing is committed. Remove the data, or keep it out of the repo entirely.');
  process.exit(1);
}
console.log(`precommit-scan: clear (${stagedFiles.length} staged file(s))`);
