# Security Policy

## Reporting Security or Privacy Issues

If you discover a security vulnerability, privacy leak, or privilege escalation issue in any of the scripts in this repository, please do **not** disclose it in a public issue or discussion.

To report privately:
- Open a private security advisory via [GitHub Security Advisories](https://github.com/shivanshjain456/browser-workflow-tools/security/advisories/new).
- Provide a clear description of the issue, reproducing steps or proof-of-concept, and the specific script and environment tested.
- Submissions will be acknowledged within 48 hours, followed by a fix and coordinated disclosure.

---

## Threat Model

The tools in this repository operate as browser userscripts with elevated userscript manager privileges (such as cross-origin HTTP requests, clipboard modification, and persistent GM storage). Because they interact with third-party web pages, untrusted page DOMs, user-supplied files, and remote archive responses, our security model implements defense-in-depth across five key attack surfaces:

### 1. Untrusted Page DOM & Page Data
- **Threat:** Malicious or compromised web pages injecting scripts or HTML markup into userscript interfaces or clipboard exports.
- **Defense:**
  - Zero dynamic `innerHTML` or `outerHTML` sinks for untrusted data.
  - Safe DOM tree construction (`document.createElement`, `textContent`, safe attribute assignment).
  - Explicit XML escaping for OOXML DOCX document generation (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`).
  - Strict URL scheme validation rejecting dangerous protocols (`javascript:`, `data:`, `file:`).

### 2. Local Files & Directory Traversal
- **Threat:** User-selected codebases or archive members containing traversal paths (`../`, `..\`) or malicious symlinks targeting system files.
- **Defense:**
  - Paths are defensively normalized to POSIX standard; traversal sequences (`..`) are strictly resolved or stripped before processing.
  - ZIP member extraction enforces entry boundary checks and decompression limits.
  - Secret file pattern scanner alerts the user when sensitive credential files (`.env`, `id_rsa`, `*.pem`, `secrets.json`) are present before packing.

### 3. Remote Network & Cross-Origin Requests
- **Threat:** Malicious redirection, SSRF, or data exfiltration to attacker-controlled origins.
- **Defense:**
  - Absolute ban on `@connect *` wildcard grants across all publication artifacts.
  - Static `@connect` domain allowlist strictly limited to official archive endpoints and origin platforms.
  - No authorization tokens, cookies, or signed URLs are ever sent to third-party endpoints.
  - Cross-origin responses are treated as untrusted data: URLs returned by archive APIs are strictly re-validated before navigation or presentation.

### 4. Imported Configuration & User Settings
- **Threat:** Maliciously crafted settings files or template strings designed to execute code or probe unauthorized networks.
- **Defense:**
  - Imported configurations are validated against strict JSON schemas and value ranges before persistence.
  - Custom templates are evaluated and sanitized after substitution, not just before substitution.
  - Settings cannot dynamically expand `@connect` network permissions beyond the statically declared manifest.

### 5. Diagnostics & Logging
- **Threat:** Accidental leakage of user tokens, private conversation text, or file contents into browser console logs.
- **Defense:**
  - Logging is minimal and disabled in production by default.
  - When debug diagnostics are enabled, sensitive parameters (API tokens, authorization headers, passwords) are automatically redacted.
  - Verified by automated CI security unit tests (`tests/security-privacy.test.mjs`).
