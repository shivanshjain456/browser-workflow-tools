# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security or privacy problem.**

Preferred route: GitHub's **private vulnerability reporting** on this
repository — *Security* tab → *Report a vulnerability*.

> **Owner action required:** private vulnerability reporting must be enabled for
> the repository (*Settings → Security → Private vulnerability reporting*). It is
> a repository setting, not something a file can switch on. Until it is enabled,
> this route does not exist; the owner must either enable it or add a monitored
> contact address to this file. No address is fabricated here on purpose.

Please include: the script version, manager and browser versions, what an
attacker controls, the impact, and (if you have one) a minimal reproduction.
A proof-of-concept is welcome; please keep it private until a fix is released.

## What is in scope

* The userscript's handling of untrusted input: page-authored DOM events,
  settings/imports, manager responses, file names.
* Privilege questions: anything that lets page script reach the script's
  manager capabilities, page storage, or the network without user action.
* Data exposure: anything that could leak the images, URLs or settings the script
  handles.
* Supply chain of the *shipped artifact*: the built file must contain no remote
  code, no dynamic code and no undeclared destination.

## What is out of scope

* Vulnerabilities in browsers or userscript managers themselves — report those
  upstream.
* Anything requiring the user to install a modified copy of the script.
* Missing security hardening in features that do not yet exist (see
  [Compatibility](docs/compatibility.md) for the current limitations).
* Requests to bypass site permissions, DRM or authentication — those are refused
  by design, not a vulnerability.

## Design promises relevant to security

* The script never publishes a privileged handle to page script, and it has no
  page-controlled boot flag.
* Nothing is written to page storage (no `localStorage`/`sessionStorage`/
  `IndexedDB`/cookies).
* No telemetry, no remote configuration, no update check, no remote code, no
  `eval`, no HTML sinks.
* Network requests are limited to fetching an image you explicitly asked to
  convert; no uploads ever.
* Untrusted data is validated before use; a failing validation produces a warning
  and a safe default, not an exception path into privileged code.

## Supported versions

The latest released version is supported. Older versions receive no security
backports; update by reinstalling the newer file (see
[docs/installation.md](docs/installation.md#5-updates-rollback-removal)).
