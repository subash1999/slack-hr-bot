---
name: slack-hr-bot
description: "Project setup and scaffolding skill for the Slack HR Bot — a free Slack-based attendance, leave, daily reporting, hours enforcement, and payroll system. Use this skill whenever the user mentions: setting up the HR bot, building attendance tracking, configuring Slack commands for employee management, creating Google Apps Script backend for HR, setting up Google Sheets as HR database, employee onboarding/offboarding flows, leave management workflows, daily standup report systems, work hours tracking with minimum enforcement, salary/payroll calculation, or any task related to building or extending this Slack-based HR tool. Also trigger when the user references 'the company', 'slack hr', 'attendance bot', 'clock in/out system', or 'employee hours tracking'."
---

# Slack HR Bot - Project Setup Skill

This skill helps scaffold, configure, and extend the Slack HR Bot project — a 100% free employee management system built on Slack + Google Apps Script + Google Sheets.

## When to Use This Skill

Use this skill when the user wants to:
- Set up or extend the Slack HR Bot project
- Create or modify Google Apps Script backend code
- Design Google Sheets database structure
- Add new Slack slash commands or workflows
- Configure employee groups, policies, or onboarding flows
- Implement hours tracking, leave management, or payroll logic
- Create daily reporting features
- Debug or troubleshoot the HR bot

## Architecture Overview

```
Slack (slash commands + interactive messages)
        ↓
Google Apps Script (deployed as Web App — free backend)
        ↓
Google Sheets (12-tab database — see SCHEMA.md)
```

**Stack is 100% free:** Slack Free Plan + Google Apps Script + Google Sheets.

## Project Location

The project lives at: `the company/slack-hr-bot/`

```
slack-hr-bot/
├── README.md                       # Project overview
├── docs/
│   ├── REQUIREMENTS.md             # Complete requirements spec
│   ├── SCHEMA.md                   # Database schema (8 Google Sheet tabs)
│   ├── SLACK_COMMANDS.md           # All commands, flows, responses
│   ├── DAILY_REPORTING_AND_HOURS_POLICY.md  # Reports + 3-level hours enforcement
│   └── ONBOARDING.md              # Employee onboarding/offboarding
├── config/
│   ├── google_sheets_template.md   # Sheet setup guide
│   └── slack_app_setup.md          # Slack app setup guide
├── src/                            # Google Apps Script code
├── scripts/                        # Utility scripts
└── tests/                          # Test cases
```

## Before Starting Any Work

1. Read the relevant docs first. The `docs/` folder has comprehensive specs:
   - For attendance/commands → read `SLACK_COMMANDS.md`
   - For database changes → read `SCHEMA.md`
   - For hours/reporting → read `DAILY_REPORTING_AND_HOURS_POLICY.md`
   - For new employees → read `ONBOARDING.md`
   - For anything → start with `REQUIREMENTS.md`

2. Understand the data model. All data is in Google Sheets with 12 tabs:
   - Employees, Events, LeaveRequests, DailyReports, Policies, Overrides, Flags, HoursBank, QuotaPlans, PreApprovals, SalaryHistory, MonthlySummary

   **Important**: Only TWO contractor groups exist: "Full-Time Contract Developer" (3h/30h/160h) and "Contract Intern" (3h/15h/80h)

3. Follow the event-based pattern. Attendance uses append-only event logging (IN/OUT/BREAK_START/BREAK_END), never row editing.

## Core Modules

### 1. Attendance (Event-Based)
- Commands: `/in`, `/out`, `/break`, `/back`, `/clock-status`
- Events are appended to the Events sheet, never edited
- Hours = SUM(OUT-IN) - SUM(BREAK_END-BREAK_START)
- See `docs/SLACK_COMMANDS.md` for detailed flows

### 2. Leave Management
- Command: `/request-leave YYYY-MM-DD`
- Types: Paid (8h credit), Unpaid (0h), Shift Permission (0h, present)
- Manager approval via Slack buttons
- Leave accrual: configurable start month + rate per month
- See `docs/REQUIREMENTS.md` section 3.2

### 3. Daily Reports
- Command: `/report` (separate from `/in`)
- Format: Yesterday (done) | Today (plan) | Blockers
- Employees reference JIRA ticket IDs and GitHub PR numbers
- Phase 2: auto-compare with JIRA/GitHub activity
- See `docs/DAILY_REPORTING_AND_HOURS_POLICY.md`

### 4. Hours Enforcement (3-Level) + Banking + Quota Redistribution
- Daily, Monthly minimums — all tracked (NO weekly surplus tracking)
- Core working hours: 3 hours per day (mutually agreed)
- Shortfalls generate flags for manager review
- Only monthly flags result in actual salary deduction (after approval)
- Daily/weekly are early warnings for employee self-adjustment
- **Hours Banking**: surplus hours carry forward to offset future deficits (manager-approved only, NOT cashable)
  - Surplus hours WITHOUT prior manager approval are NOT eligible for banking
  - Only manager-approved surplus hours can be banked or taken as leave
  - When manager approves surplus, they specify max_leave_days convertible from that surplus
  - Surplus expires after 12 months if not used
  - Surplus hours are NEVER cashable under any circumstances
  - System sends expiry warnings at 30 days before expiry
  - Auto-forfeiture on expiry date
- **Quota Redistribution**: manager can pre-adjust requirements across periods (e.g., 140h April + 180h May)
- **Pre-Approved Absences**: manager pre-approves days off, skipping flag generation entirely
- **New Commands**: `/approve-surplus` (manager proactively approves banking), `/my-bank` (employee views their banked hours), `/edit-employee` (admin edits employee info)
- See `docs/DAILY_REPORTING_AND_HOURS_POLICY.md` and `docs/REQUIREMENTS.md` sections 3.6b-3.6d Part 2

### 5. Payroll & Salary Tracking
- Currency: NPR (Nepalese Rupees)
- Payment: Within 15 days of following month in NPR
- TDS: No TDS withholding by company
- Salary resolved from SalaryHistory via `getEffectiveSalary(userId, yearMonth)` — NOT from Employees.salary
- hourly_rate = effective_salary / required_monthly_hours
- deficit = required - actual (worked + paid leave)
- deduction = deficit × hourly_rate (only if manager approves flag), rounded up to nearest NPR
- Surplus hours are NEVER cashable and cannot be paid out (require manager approval to bank)
- Commands: `/payroll` (employee self-service), `/team-payroll` (manager), `/salary-history` (manager view/update)
- See `docs/REQUIREMENTS.md` sections 3.7, 3.7b, 3.7c

### 6. Onboarding
- Onboarding is done via `/onboard` Slack modal (not manually in Sheets)
- Command: `/onboard` (admin-only modal to add new employees)
- Post-onboarding: `/edit-employee` for editing employee info (hours, salary, leave accrual, etc.)
- Bot sends welcome DM on first command
- See `docs/ONBOARDING.md`

## User Roles
- **Employee**: Clock in/out, reports, leave requests, view own data
- **Manager**: Approve leave, resolve flags, view team data
- **Admin**: Configure everything, view payroll

## Key Design Decisions
- Google Sheets is the database (not Notion, not Supabase)
- Employees never touch Google Sheets — Slack only
- Event-based logging (append-only) for data integrity
- Monthly deduction only (daily/weekly are warnings)
- Manager must approve all deductions (no auto-deduct)
- Leave accrual is configurable per employee

## When Implementing Code

Write Google Apps Script code in `src/`. The main entry point is `doPost(e)` which routes all Slack slash commands. Follow the routing pattern in `docs/SLACK_COMMANDS.md`.

Key patterns:
- All commands go to the same Apps Script URL
- Parse `e.parameter.command` to route
- Use `SpreadsheetApp` to read/write sheets
- Use `UrlFetchApp` to post messages back to Slack
- Store `SLACK_BOT_TOKEN` in Script Properties

## HR Policies & Contracts Integration

**Organizational Structure:**
- CEO: John Doe (top of hierarchy)
- Contractor groups: Full-Time Contract Developer, Contract Intern

The Slack HR Bot enforces policies defined in the HR contracts system:

- **HR Policies**: `the company/hr-contracts/docs/HR_POLICIES.md` — 10-section policy document covering work hours, leave, compensation, IP, confidentiality, non-compete, daily reporting, code of conduct, termination, dispute resolution
- **Nepal Law Reference**: `the company/hr-contracts/docs/NEPAL_LAW_REFERENCE.md` — Legal framework for contractor agreements
- **Contract Templates**: `the company/hr-contracts/templates/` — .docx contract templates synced with bot policies
- **Contract Creator Skill**: `the company/hr-contracts/.claude/skills/nepal-freelance-contract-creator/` — Skill for drafting Nepal-compliant freelance contracts

When modifying bot behavior related to hours, leave, or payroll, always check HR_POLICIES.md to ensure consistency between the bot implementation and the contractual obligations.
