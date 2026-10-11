# Contributing Guidelines

Thank you for your interest in improving this collection of browser workflow tools. Contributions that enhance security, compatibility, accessibility, and documentation are welcome.

---

## Development Setup

The repository is built with standard ECMAScript modules and native Node.js tooling:

```bash
# Clone the repository
git clone https://github.com/shivanshjain456/browser-workflow-tools.git
cd browser-workflow-tools

# Verify node version (Node 20+ required)
node --version

# Run the complete test and quality suite
npm run ci
```

---

## Quality & Security Gates

Before submitting a pull request, ensure all local checks pass:

1. **Syntax Validation:**
   ```bash
   npm run check:syntax
   ```
   Ensures all published userscripts parse cleanly into the JavaScript runtime.

2. **Metadata Audit:**
   ```bash
   npm run check:meta
   ```
   Verifies that `@name`, `@namespace`, semver `@version`, `@author`, `@license`, and canonical URLs are valid and unique.

3. **Privilege & Network Audit:**
   ```bash
   npm run check:perm
   ```
   Asserts that **no wildcard `@connect *`** exists in any script and synchronizes `PERMISSIONS.md`.

4. **Secret Scanning:**
   ```bash
   npm run check:secrets
   ```
   Ensures no private API keys, tokens, or credentials exist in tracked files.

5. **Unit Tests:**
   ```bash
   npm run test
   ```
   Runs pure-function unit tests with zero external dependencies.

---

## Pull Request Checklist

- [ ] Script installs and executes cleanly in Tampermonkey and Violentmonkey.
- [ ] No wildcard `@connect *` added to any manifest.
- [ ] No `innerHTML` or dynamic parser sinks for untrusted page data.
- [ ] Semver bumped in both the script header and `CHANGELOG.md`.
- [ ] `npm run ci` passes with 0 errors and 0 warnings.
- [ ] Documentation updated to reflect any new features or privacy changes.
