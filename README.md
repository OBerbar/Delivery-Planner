# Delivery Studio

**Visualize your team's capacity and calculate how surprises affect delivery—in minutes.**

Delivery Studio puts people, features, availability, and leave on a timeline so you can answer: **“If this changes, what happens to everything else?”**

It is not a project-management system or a Scrum-workflow tool. Keep using Jira, ClickUp, Trello, or Linear for managing daily work. Use Delivery Studio alongside them for a quick view of capacity and delivery consequences. There is no automatic connection to those tools.

For delivery managers, Scrum masters, product owners, founders/co-founders, and team leads—including teams that do not use sprints.

## What you can explore

- Give each developer a different estimate: three working days from one person and seven from another, with separate bookings on the person timeline.
- Click a feature name to inspect start, forecast delivery, per-person effort and the constraints shaping its forecast.
- Choose Ignore leave for a feature when personal leave should not change its forecast; holidays and competing work still count.
- Add personal full/partial leave, or apply a reusable leave/holiday template to one person, several people, or the whole current app team.
- Add an unexpected feature or raise its priority; review affected dates and calculated calendar-day delays before saving.
- Use What-if planning to try alternatives, compare them with the saved plan, then apply or discard the experiment.
- Export a timeline PDF, back up the workspace, and use optional sprint capacity/plans when useful.

Think of a five-minute planning conversation once your inputs are ready. Installation and first-time data entry are separate; the five-minute idea is a usability target rather than a guaranteed setup time. Forecasts reflect the estimates and calendars entered.

## Run this source edition

The interface runs in your browser, with a server and database on your own computer. Install from source with Node.js and a terminal, or use the portable beta downloads below.

For the portable beta, download the matching Windows or Mac ZIP from [GitHub Releases](https://github.com/OBerbar/Delivery-Planner/releases), extract it completely, and open Delivery Studio.exe or Delivery Studio.app. No Node installation or terminal is needed. Read [Download and installation](docs/download-and-install.md) for exact steps and unsigned-beta warnings.

The following instructions install from source:

1. Install Node.js 22.12 or later.
2. Download this repository's source ZIP and extract it, or clone the repository.
3. Open a terminal in the extracted project folder and run:

```sh
npm ci
npm run build
npm start
```

4. Open **http://127.0.0.1:4311** in your browser. Keep the terminal open; Control-C stops the server.

On Mac, after installing Node.js, the existing **Start Delivery Studio.command** launcher can install dependencies, build, and open the app. The old Start Sprint Studio.command remains a compatibility alias. Windows users of this source edition use the commands above.

## Make a quick delivery check

Open the setup wizard and create your own project, or choose **Use example team** for the fictional Northstar team. Every name, role, and estimate is editable. The example fills six fictional people and neutral planning guidance; it contains no real project records. The wizard defaults to a feature timeline with working-day estimates. Turn on Plan in sprints only if you want a first sprint.

Follow the [quick delivery walkthrough](docs/user-manual.md#quick-delivery-check), then consult the [complete manual](docs/user-manual.md).

## Your data

Your workspace is saved in `data/planner.sqlite` by default. The directory may contain companion SQLite files while running. Export full backup in App settings backs up the entire workspace; Restore backup replaces that workspace after validation and confirmation. Keep personal backups private and back up before updating. Do not manually edit the database while the server is running.

A new source download starts empty. There is no account, hosted database, cloud sync, or live team collaboration. Share exported plans when needed. Do not expose the local server to the internet.

## Development and verification

Run `npm run dev` and open http://127.0.0.1:4310. Tests use isolated ports and databases rather than your saved workspace.

```sh
npm test
npm run check:docs
npm run build
```

For the complete `npm run verify` suite, install Google Chrome and the WebKit runtime with `npx playwright install webkit`. macOS screenshot references are platform-specific; compare them in their reference environment. See the [feature coverage map](docs/feature-coverage.md) and [agent instructions](AGENTS.md).

For bug reports, provide synthetic reproduction steps and your app/runtime version. Do not upload a real full-workspace backup, private plans, or screenshots containing other people's information.

## Try a safe example

Choose **Try sample workspace** in setup or **App settings** to open the fictional Northstar plan in a separate tab. Sample changes stay in memory; your saved workspace stays separate. Follow the screenshot [first-plan walkthrough](docs/first-plan.md), then the [download and installation guide](docs/download-and-install.md). Both guides are available locally from the sample banner.

## Versions and contributions

The canonical source is [OBerbar/Delivery-Planner](https://github.com/OBerbar/Delivery-Planner). The current release is **1.0.0-beta.1**. See [CHANGELOG.md](CHANGELOG.md) for release history and [release/RELEASING.md](release/RELEASING.md) for the version/tag/download process. GitHub Releases contains versioned Mac and Windows packages, a source archive and SHA-256 checksums. Your local database is never part of this repository or its downloads.

Released under the [MIT license](LICENSE). Contributions should use feature branches and pull requests, include meaningful regression coverage, and preserve existing workspace compatibility.
