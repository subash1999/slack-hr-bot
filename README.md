<p align="center">
  <h1 align="center">Slack HR Bot</h1>
  <p align="center">
    <strong>Complete HR management system running entirely in Slack — zero cost</strong>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" />
    <img src="https://img.shields.io/badge/Google_Apps_Script-Serverless-4285F4?style=flat-square&logo=google&logoColor=white" />
    <img src="https://img.shields.io/badge/Slack-Bot-4A154B?style=flat-square&logo=slack&logoColor=white" />
    <img src="https://img.shields.io/badge/Cost-$0/month-brightgreen?style=flat-square" />
  </p>
</p>

---

## What It Does

A Slack-based attendance, leave, daily reporting, hours enforcement, and payroll system designed for small teams (10-15 people). Everything happens through slash commands — no external UI needed.

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│    Slack      │────▶│  Google Apps Script  │────▶│  Google Sheets   │
│ (24 commands) │◀────│  (serverless logic)  │◀────│  (12-tab DB)     │
└──────────────┘     └─────────────────────┘     └──────────────────┘
```

---

## Features

| Module | Commands | What It Does |
|--------|----------|-------------|
| **Attendance** | `/in` `/out` `/break` `/back` | Clock in/out with multiple break sessions |
| **Leave** | `/leave` `/approve-leave` | Paid/unpaid/shift leave with manager approval workflow |
| **Reports** | `/report` | Daily standup reports referencing JIRA tickets & GitHub PRs |
| **Hours** | `/hours` `/shortfall` | 3-level enforcement: daily (6h), weekly (30h), monthly (120h) |
| **Payroll** | `/salary` | Auto-calculate salary based on hours deficit + manager flags |
| **Admin** | `/onboard` `/offboard` `/config` | Full employee lifecycle management |

### Hours Enforcement System

```
Daily Minimum ──── 6 hours ──── Flagged at end of day
      │
Weekly Minimum ─── 30 hours ─── Flagged on Friday
      │
Monthly Minimum ── 120 hours ── Salary impact calculated
```

### Role-Based Access

| Role | Capabilities |
|------|-------------|
| **Employee** | Clock in/out, submit reports, request leave, view own hours |
| **Manager** | + Approve leave, resolve shortfall flags, view team summary |
| **Admin** | + Configure employees, groups, policies, view payroll |

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Interface | Slack Free Plan | Slash commands + Block Kit interactive messages |
| Backend | Google Apps Script | Free serverless, auto-scales, no infra to manage |
| Database | Google Sheets (12 tabs) | Free, formula engine, easy to audit/export |
| Build | TypeScript + esbuild | Type safety, bundled to single GAS-compatible file |
| CI/CD | GitHub Actions + clasp | Auto-deploy on push |
| Testing | Jest | Unit + integration tests |

> **Total infrastructure cost: $0/month** — runs entirely on free tiers.

---

## Database Schema (Google Sheets)

The system uses **12 interconnected tabs** as its database:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Employees  │  │   Groups    │  │  Policies   │
│  (master)   │──│  (teams)    │──│  (rules)    │
└──────┬──────┘  └─────────────┘  └─────────────┘
       │
  ┌────┴────┬──────────┬───────────┬──────────┐
  ▼         ▼          ▼           ▼          ▼
┌──────┐ ┌──────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Clock │ │Leave │ │Reports │ │Hours   │ │Salary  │
│Logs  │ │Reqs  │ │        │ │Summary │ │History │
└──────┘ └──────┘ └────────┘ └────────┘ └────────┘
```

---

## Project Structure

```
slack-hr-bot/
├── src/
│   ├── main.ts              # Entry point — routes Slack commands
│   ├── auth.ts              # Role-based auth middleware
│   ├── config.ts            # App configuration
│   ├── handlers/            # Command handlers (one per module)
│   │   ├── attendance.ts    # /in, /out, /break, /back
│   │   ├── leave.ts         # /leave, /approve-leave
│   │   ├── report.ts        # /report
│   │   ├── hours.ts         # /hours, /shortfall
│   │   ├── salary.ts        # /salary
│   │   ├── admin.ts         # /onboard, /offboard, /config
│   │   └── ...
│   ├── core/                # Business logic
│   ├── services/            # Google Sheets + Slack API wrappers
│   ├── triggers/            # Scheduled triggers (daily/weekly/monthly)
│   └── utils/               # Date, format, validation helpers
├── tests/
│   ├── unit/                # Pure function tests
│   ├── integration/         # Handler tests with mocked services
│   └── fixtures/            # Test data
├── config/                  # Setup guides (Slack app, Google Sheet)
├── docs/                    # Full requirements, schema, command reference
└── .github/workflows/       # CI + deploy pipeline
```

---

## Quick Start

```bash
# Clone
git clone https://github.com/subash1999/slack-hr-bot.git
cd slack-hr-bot

# Install
npm install

# Run tests
npm test

# Build for Google Apps Script
npm run build

# Deploy (requires clasp setup)
npm run deploy
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Complete feature spec — rules, edge cases, data model |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | All 12 Google Sheet tabs with columns and relationships |
| [`docs/SLACK_COMMANDS.md`](docs/SLACK_COMMANDS.md) | All 24 slash commands with flows and response formats |
| [`docs/DAILY_REPORTING_AND_HOURS_POLICY.md`](docs/DAILY_REPORTING_AND_HOURS_POLICY.md) | Report format + 3-level hours enforcement rules |
| [`docs/ONBOARDING.md`](docs/ONBOARDING.md) | Employee onboarding/offboarding step by step |
| [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) | Phased implementation plan (~50 hours) |
