# Support

Please use the right channel — it is much easier to help that way.

| I need… | Where |
|---|---|
| Help installing or using the script | Open a **Question** issue (or a *Bug report* if something is broken) |
| To report a reproducible bug | **Bug report** issue form — include version, browser, manager, steps, expected/observed, and Diagnostics output |
| To ask for a feature | **Feature request** form — describe the workflow, not only the mechanism |
| To report a compatibility result | A *Bug report* with the diagnostics panel contents is fine; say "works" in the title if it works |
| To report a security or privacy problem | [SECURITY.md](SECURITY.md) — **not** a public issue |
| To contribute code or docs | [CONTRIBUTING.md](CONTRIBUTING.md) |

Before filing, please skim [Troubleshooting](docs/troubleshooting.md) — the most
common causes (user-script permission off, cross-origin fetch disabled, strict
page CSP) are explained there with concrete steps.

## What to include in a report

1. Script version (manager dashboard) and the manager's name + version.
2. Browser name and version, and the operating system.
3. What you did, what you expected, what happened.
4. The Diagnostics panel contents (it lists probed manager/browser capabilities,
   storage state and encoder availability).
5. If a page is involved: the site type or a minimal reproduction that does not
   require a login. **Never paste private URLs, tokens or personal data.**

## What this project is not

* It is not a service: there is no server, no account, and nobody can see your
  images. The maintainers cannot debug what happens on your machine beyond what
  you report.
* It does not bypass site permissions, DRM, paywalls or authentication, and
  requests to do so will be closed.
* There is no guaranteed response time. This is a volunteer project; security
  reports are prioritised, feature requests are not.
