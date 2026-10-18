#!/usr/bin/env python3
"""
Mechanical verifier for post-release-retest-2026-10-17 evidence bundle.
Verifies:
1. Every indexed file exists on disk.
2. Every file's SHA-256 matches the table in EVIDENCE.md.
3. Every transcript starts with the required 4 comment headers:
   # command: ...
   # commit: ...
   # artifact sha256: ...
   # timestamp UTC: ...
4. Every transcript ends with:
   # exit: <expected_code>
5. Line endings are strictly LF.
"""
import sys, re, hashlib
from pathlib import Path

evidence_dir = Path(__file__).resolve().parent
evidence_md = evidence_dir / "EVIDENCE.md"

if not evidence_md.exists():
    print("FAIL: EVIDENCE.md does not exist")
    sys.exit(1)

table_pattern = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^\|]+)\s*\|\s*([^\|]+)\s*\|\s*`([0-9a-f]{64})`\s*\|\s*([^\|]+)\s*\|$")

errors = []
checked = 0

with open(evidence_md, "r", encoding="utf-8") as f:
    for line in f:
        m = table_pattern.match(line.strip())
        if not m:
            continue
        fname, cmd, res, proves, expected_sha, ts = m.groups()
        fpath = evidence_dir / fname
        if not fpath.exists():
            errors.append(f"Missing file: {fname}")
            continue
        
        raw = fpath.read_bytes()
        actual_sha = hashlib.sha256(raw).hexdigest()
        if actual_sha != expected_sha:
            errors.append(f"SHA mismatch for {fname}: expected {expected_sha}, got {actual_sha}")
        
        if b"\r\n" in raw:
            errors.append(f"CRLF line endings detected in {fname}")
            
        if fname.endswith(".txt"):
            text = raw.decode("utf-8")
            lines = text.strip().split("\n")
            if not lines[0].startswith("# command:"):
                errors.append(f"{fname} missing '# command:' header")
            if not lines[1].startswith("# commit:"):
                errors.append(f"{fname} missing '# commit:' header")
            if not lines[2].startswith("# artifact sha256:"):
                errors.append(f"{fname} missing '# artifact sha256:' header")
            if not lines[3].startswith("# timestamp UTC:"):
                errors.append(f"{fname} missing '# timestamp UTC:' header")
            if not lines[-1].startswith("# exit:"):
                errors.append(f"{fname} missing '# exit:' footer")
                
        checked += 1

if errors:
    print(f"FAILED with {len(errors)} errors:")
    for err in errors:
        print(f"  - {err}")
    sys.exit(1)

print(f"PASS: Verified {checked} evidence items successfully. All hashes, headers, footers, and line endings match.")
