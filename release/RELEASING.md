# Version and release process

The live checkout of [OBerbar/Delivery-Planner](https://github.com/OBerbar/Delivery-Planner) is the only application source. Generated folders under output/ are artifacts, never another development branch. The database remains private in data/ (source edition) or the per-user application-data folder (portable edition).

## Prepare a change

1. Work on a feature branch, add meaningful regressions and update the manual/coverage map.
2. Run npm run verify. Review UI changes on desktop and iPad using synthetic data. Never change personal records for testing.
3. Review git status, the complete staged file list and diff. Never stage data, backups, credentials, marketing drafts, launch strategy, internal archives, dependencies or build output.
4. Submit the verified change through a pull request; maintainers merge approved contributions to main. Keep release preparation separate from unreviewed work and never build a release from an old export copy.

## Cut a release

1. Choose the next version: increment the patch for fixes, minor for compatible features, major for incompatible changes; use beta.2, beta.3 and so on before a stable release. Do not reuse a released version.
2. Set the same exact version in package.json and the root/package entries in package-lock.json. Update CHANGELOG.md and this release's installation filenames/README version together. Runtime STORAGE_SCHEMA_VERSION changes only when persisted fields or validation require it.
3. Complete npm run verify and commit all release changes. Confirm git status --porcelain is empty. Create an annotated v<package-version> tag at that commit.
4. Build from that exact clean checkout: npm run build, node release/fetch-runtime-artifacts.mjs, then node release/build-downloads.mjs output/downloads-<version>. The builder uses package.json verbatim and checks a tag supplied by GitHub Actions.
5. Generate the source ZIP with git archive --format=zip --prefix=Delivery-Studio-<version>/ --output=output/downloads-<version>/Delivery-Studio-<version>-source.zip v<version>. Add its SHA-256 to SHA256SUMS.txt. git archive includes only committed public files.
6. Verify every checksum, inspect ZIP contents for saved data/credentials, extract outside the checkout and run node release/smoke-download.mjs on Apple silicon with isolated synthetic data. Native Intel Mac, Windows 10/11 and first-download security checks must be recorded separately; cross-compilation is not native verification.
7. Push main and the annotated tag without force. Publish a GitHub prerelease for beta versions with the three application ZIPs, source ZIP and SHA256SUMS.txt. Include changes, checks, platform limitations and backup/update steps. Never replace a published tag or asset; correct errors with a new release.
8. Read back the remote commit/tag and release assets. Confirm your live checkout still matches the published source. Keep local runtime data outside Git.

The repository's CI checks formatting, types, builds, unit/API tests, packaging regressions and documentation on pushes and pull requests. The complete browser/visual and native-package checks above are additional release requirements.
