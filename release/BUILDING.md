# Build the portable beta downloads

This is the contributor route. People using Delivery Studio should follow [Download and installation](../docs/download-and-install.md).

The current release builder runs on an **Apple silicon Mac** with Xcode Command Line Tools (`cc`, `codesign`, `tar`). It creates Apple silicon Mac, Intel Mac, and Windows x64 ZIPs. It downloads a pinned Go toolchain only to compile the Windows GUI launcher; users do not need Go or Node installed.

From the source folder, after `npm ci`:

```sh
npm run build
node release/fetch-runtime-artifacts.mjs
node release/build-downloads.mjs
```

The builder reads [runtime-artifacts.json](runtime-artifacts.json) and verifies every SHA-256 value before using an artifact. Node 24.21.0 binaries come from the [official Node distribution](https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt). SQLite 12.11.1 ABI 137 assets come from the [upstream release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.11.1). The build-only toolchain comes from [Go downloads](https://go.dev/dl/). Updating these pins requires reviewing version, architecture, ABI, OS minimum, digest and upstream notices together.

ZIPs and SHA256SUMS.txt appear in `output/downloads`. Existing output folders are never overwritten; pass a new destination as the first argument to build again. Unpacked packages and the internal build record live under `output/package-build`. Only ZIPs and the checksum file are release assets. Server modules are copied from the installed lockfile closure; every external import of the compiled server is resolved inside the packaged dependency folder, rejecting development-folder fallback. The application MIT license, frontend and server licence notices, Node's licence, and Windows launcher's Go notices are included. Personal databases and source history are never inputs.

Mac packages require **macOS 13.5+**, matching [Node 24's platform requirement](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list). The small native helper has an ad-hoc signature for local execution; these apps have no verified publisher signature and are not notarized. Windows packages are unsigned. Verify security prompts on freshly downloaded/quarantined files before public release; locally generated files do not reproduce every download warning.

Run the isolated lifecycle check on an extracted application folder:

```sh
node release/smoke-download.mjs "/path/to/Delivery Studio"
```

It creates temporary synthetic data, runs the native launcher with an empty PATH, checks bundled Node, save/reopen, simultaneous launches, same-instance reuse, quit-token/origin rejection, replacement-folder retention and occupied-port recovery. An optional third argument supplies a synthetic fixture JSON. It never uses the normal saved-data folder. On Windows, the same script can be run using the extracted package's `resources/runtime/node.exe` if Node is not installed; it remains a developer check, not a requirement for using the app.

Run `npm run verify` in the source tree. Check the actual Mac binary OS minimum and each Windows PE architecture, inspect notices and archive contents, and do the Windows 10/11 Explorer/browser/security checks in the installation guide. Cross-compilation does not prove Windows execution. Neither source publication nor GitHub release upload is performed by these scripts.
