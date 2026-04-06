# Slack HR Bot

Slack-based attendance, leave, daily reporting, and payroll system for a 10-15 member team. 100% free stack.

## Architecture

```
Slack (slash commands) → Google Apps Script (backend) → Google Sheets (database)
```

## Features

- **Attendance**: Clock in/out with multiple breaks (`/in`, `/out`, `/break`, `/back`)
- **Leave Management**: Paid/unpaid/shift with manager approval workflow
- **Daily Reports**: Standup reports referencing JIRA tickets & GitHub PRs
- **Hours Tracking**: 3-level enforcement (daily/weekly/monthly minimums)
- **Payroll**: Auto-calculate salary based on hours deficit + manager-approved flags
- **Onboarding**: Full employee setup with group policies and leave accrual

## Project Structure

```
slack-hr-bot/
├── README.md
├── docs/
│   ├── REQUIREMENTS.md          # Complete feature requirements
│   ├── SCHEMA.md                # Google Sheets database schema (12 tabs)
│   ├── SLACK_COMMANDS.md        # All 24 slash commands & workflows
│   ├── BUILD_PLAN.md            # Phased build plan (~50 hours)
│   ├── DAILY_REPORTING_AND_HOURS_POLICY.md  # Reports + hours enforcement
│   └── ONBOARDING.md            # Employee onboarding/offboarding
├── config/
│   ├── google_sheets_template.md  # How to set up the Google Sheet (12 tabs)
│   ├── initial_data.md            # Initial data to load into sheets
│   └── slack_app_setup.md         # How to set up the Slack app
├── src/                           # Apps Script code (to be built)
├── scripts/                       # Utility scripts
└── tests/                         # Test cases
```

## Quick Start

1. Read `docs/REQUIREMENTS.md` for full system overview
2. Set up Google Sheet using `config/google_sheets_template.md`
3. Set up Slack App using `config/slack_app_setup.md`
4. Deploy Apps Script code from `src/`
5. Test all commands

## User Roles

- **Employee**: Clock in/out, submit reports, request leave, view hours
- **Manager**: Approve leave, resolve shortfall flags, view team summary
- **Admin**: Configure employees, groups, policies, view payroll

## Tech Stack

- Slack Free Plan (slash commands + interactive messages)
- Google Apps Script (free serverless backend)
- Google Sheets (free database + formula engine)

## Docs Quick Reference

| Document | What's Inside |
|----------|--------------|
| REQUIREMENTS.md | Everything — features, rules, edge cases, data model |
| SCHEMA.md | All 12 Google Sheet tabs with columns and relationships |
| SLACK_COMMANDS.md | Every command, its flow, responses, and routing |
| DAILY_REPORTING_AND_HOURS_POLICY.md | Report format + 3-level hours enforcement |
| ONBOARDING.md | Adding/removing employees step by step |
