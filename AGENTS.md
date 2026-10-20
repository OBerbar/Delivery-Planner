# Delivery Studio — agent instructions

Delivery Studio is a local capacity and delivery-impact planner. Read README.md, docs/user-manual.md, and docs/feature-coverage.json before changing it. Consult implementation and relevant tests when behavior and documentation disagree.

- State intended behavior and acceptance examples before editing.
- For behavior changes, observe a meaningful regression fail before implementing; preserve saved-data compatibility.
- Review the manual on every change. Update it and its append-only history when user-facing behavior changes. Keep documentation and test references current in both feature-coverage files.
- Run focused tests and `npm run verify`; report exact results and incomplete checks honestly.
- Exercise changed controls in a real browser, including keyboard/focus/errors, desktop, and iPad portrait/landscape. Inspect screenshots and console/network errors.
- Use synthetic fixtures, isolated databases, and test ports. Never change someone's saved workspace to test a feature. Do not weaken tests or blindly update screenshot references.
- Keep database files, backups, generated plans, credentials, dependencies, reports, and build output private and ignored.
- Preserve finalized plan text, saved effort, and accepted dates unless changed through their intended workflows.
- Restart a running local server after server/shared-model changes. Use the same data path and confirm saved state is unchanged by restart alone. Preserve runtime-schema compatibility and update its version when persisted fields or validation change.

The public story centers on quick capacity visualization and delivery consequences of leave, priorities, and unexpected work. Use fictional examples. Setup defaults to a timeline without sprints; the optional Plan in sprints branch creates a first sprint. Preserve existing source launcher aliases and saved preference keys. Portable downloads use separate persistent per-user storage; verify lifecycle and native target execution before calling a release tested.

## Canonical source and releases

This repository is the single source of application code: https://github.com/OBerbar/Delivery-Planner. Edit the live checkout, never an old export under output/. Keep changes in Git commits. package.json and package-lock.json share the release version; Git tags use v plus that exact version. Record each release in CHANGELOG.md and follow release/RELEASING.md. Never overwrite an existing tag or release asset. Use feature branches for subsequent work and review/verify before merging. Submit verified changes through a branch and pull request. Maintainers merge approved contributions and publish packaged releases with a new version/tag. The runtime storage schema version is independent of the app release version.

Before staging, inspect the complete file list and diff for private data. Generated output, personal databases, backups and .private/ are always local-only. Test using synthetic data. Source and application ZIPs must be built from the same clean tagged commit.

## Public content boundary

Keep public documentation focused on using, contributing to and maintaining the application. Marketing drafts, launch strategy, private product decisions, personal work records and review notes belong in ignored local storage and must not be committed. Public examples and screenshots must use fictional data. Review both the file contents and intended audience before publishing; absence of credentials alone does not make a document appropriate for public release.
