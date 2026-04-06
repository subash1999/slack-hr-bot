# Slack App Setup Guide

## Step 1: Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. App Name: `Slack HR Bot`
4. Workspace: Select your workspace
5. Click "Create App"

---

## Step 2: Configure Slash Commands

Go to **Slash Commands** in the left sidebar → **Create New Command** for each:

| Command | Request URL | Description | Usage Hint |
|---------|-------------|-------------|------------|
| `/in` | `YOUR_APPS_SCRIPT_URL` | Clock in | (none) |
| `/out` | `YOUR_APPS_SCRIPT_URL` | Clock out | (none) |
| `/break` | `YOUR_APPS_SCRIPT_URL` | Start break | (none) |
| `/back` | `YOUR_APPS_SCRIPT_URL` | End break | (none) |
| `/report` | `YOUR_APPS_SCRIPT_URL` | Submit daily report | `yesterday: ... \| today: ... \| blockers: ...` |
| `/request-leave` | `YOUR_APPS_SCRIPT_URL` | Request leave | `YYYY-MM-DD` |
| `/hours` | `YOUR_APPS_SCRIPT_URL` | View hours summary | (none) |
| `/balance` | `YOUR_APPS_SCRIPT_URL` | View leave balance | (none) |
| `/clock-status` | `YOUR_APPS_SCRIPT_URL` | Check clock state | (none) |

**All commands point to the SAME Apps Script Web App URL.**

---

## Step 3: Configure Bot Token Scopes

Go to **OAuth & Permissions** → **Scopes** → Add these Bot Token Scopes:

- `chat:write` - Post messages
- `chat:write.public` - Post to channels bot isn't in
- `commands` - Handle slash commands
- `users:read` - Read user info
- `im:write` - Send DMs

---

## Step 4: Enable Interactive Components

Go to **Interactivity & Shortcuts** → Toggle ON

**Request URL:** `YOUR_APPS_SCRIPT_URL`

This handles button clicks (leave approvals, flag resolutions).

---

## Step 5: Install App to Workspace

1. Go to **Install App** in sidebar
2. Click "Install to Workspace"
3. Authorize the permissions
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
5. Save this token in your Apps Script as a script property

---

## Step 6: Create Channels

Create these channels in your Slack workspace:

| Channel | Purpose | Who joins |
|---------|---------|-----------|
| `#attendance` | Public attendance log (optional) | Everyone |
| `#daily-reports` | Daily standup summaries | Everyone |
| `#hr-flags` | Hour shortfall notifications | Managers + Admin |
| `#leave-requests` | Leave request notifications | Managers + Admin |

---

## Step 7: Get Your Apps Script URL

1. Open Google Sheet → Extensions → Apps Script
2. Paste the main script code (from src/ folder)
3. Deploy → New Deployment → Web App
4. Execute as: Me
5. Who has access: Anyone
6. Deploy → Copy the URL
7. Paste this URL in all Slack slash command configurations

---

## Step 8: Store Bot Token in Apps Script

In Apps Script:
1. Go to Project Settings (gear icon)
2. Scroll to Script Properties
3. Add property:
   - Key: `SLACK_BOT_TOKEN`
   - Value: `xoxb-your-token-here`
4. Add property:
   - Key: `SLACK_SIGNING_SECRET`
   - Value: (from Slack app Basic Information page)

---

## Testing Checklist

- [ ] `/in` → logs event, responds with confirmation
- [ ] `/out` → logs event, shows daily hours
- [ ] `/break` → logs break start
- [ ] `/back` → logs break end, shows break duration
- [ ] `/report` → accepts and stores daily report
- [ ] `/request-leave 2026-04-02` → creates request, notifies manager
- [ ] Manager approval buttons work
- [ ] `/hours` → shows correct daily/weekly/monthly hours
- [ ] `/balance` → shows correct leave balance
- [ ] `/clock-status` → shows current state
