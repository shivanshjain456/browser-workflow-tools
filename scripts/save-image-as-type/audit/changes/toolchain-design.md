# Development-only dependency remediation

`npm-audit-current.json` reproduces8high findings,0critical. Root issues are extract-zip symlink traversal (all currently published extract-zip versions flagged) and basic-ftp directory parser denial of service. None is a userscript runtime dependency. Auto-fix proposes downgrading Puppeteer to19.8.0; do not blindly force it.

Approaches: (A) overrides for FTP plus a local replacement/patch of the unmaintained ZIP extractor; (B) upgrade Puppeteer to25.14.0, whose browser installer uses modern-tar instead of extract-zip/proxy-agent/FTP, and explicitly require a supported Node>=22.22.2 toolchain. Choose B. Keep jsdom25.0.1 (no audit finding) to avoid an unrelated DOM rewrite. Pin esprima4.0.1 and js-tokens4.0.0 explicitly because our offline maintainer/security/readability tools import them; they were formerly transitive dependencies that disappear with the old Puppeteer tree.

No runtime module/permission/destination/storage key is added. Node/browser downloads are development setup only. Re-run preflight, all units with zero skips, both fixture-browser runs, exact-source probes and real-manager driver. The old Node20/Chrome131 reports remain historical evidence; do not silently relabel them as new-toolchain execution.
