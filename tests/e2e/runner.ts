/**
 * E2E test runner scaffold — sends HTTP POST to deployed GAS web app.
 *
 * Usage: GAS_DEPLOYMENT_URL=https://script.google.com/macros/s/.../exec npm run e2e
 *
 * This is a scaffold — actual E2E tests require:
 * 1. A deployed GAS web app URL
 * 2. A staging Google Sheet with all 13 tabs
 * 3. A test Slack workspace (or test channel)
 */

const DEPLOYED_URL = process.env.GAS_DEPLOYMENT_URL;

interface SlashCommandPayload {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  team_id: string;
  channel_id: string;
  response_url: string;
  trigger_id: string;
  token: string;
}

async function sendCommand(command: string, text = ''): Promise<{ status: number; body: string }> {
  if (!DEPLOYED_URL) {
    console.log('Skipping E2E: GAS_DEPLOYMENT_URL not set');
    return { status: 0, body: '' };
  }

  const payload: SlashCommandPayload = {
    command,
    text,
    user_id: 'UTEST001',
    user_name: 'e2e_tester',
    team_id: 'TTEST',
    channel_id: 'CTEST',
    response_url: 'https://hooks.slack.com/test',
    trigger_id: 'trigger-test',
    token: process.env.SLACK_VERIFICATION_TOKEN ?? '',
  };

  const body = new URLSearchParams(payload as unknown as Record<string, string>).toString();

  const response = await fetch(DEPLOYED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const responseBody = await response.text();
  console.log(`[${command} ${text}] → ${response.status}: ${responseBody.slice(0, 200)}`);
  return { status: response.status, body: responseBody };
}

async function main(): Promise<void> {
  console.log('=== E2E Tests ===');
  console.log(`URL: ${DEPLOYED_URL ?? '(not set — dry run)'}\n`);

  // Attendance flow
  console.log('--- Attendance Flow ---');
  await sendCommand('/in');
  await sendCommand('/clock-status');
  await sendCommand('/break');
  await sendCommand('/back');
  await sendCommand('/out');

  // Double /in should fail
  await sendCommand('/in');
  await sendCommand('/in'); // Should get "Already clocked in"

  // Leave flow
  console.log('\n--- Leave Flow ---');
  await sendCommand('/request-leave', '2026-04-02');

  // Payroll
  console.log('\n--- Payroll ---');
  await sendCommand('/payroll');

  // Hours
  console.log('\n--- Hours ---');
  await sendCommand('/hours');
  await sendCommand('/hours', 'week');

  // Help
  console.log('\n--- Help ---');
  await sendCommand('/hr-help');

  console.log('\n=== E2E Complete ===');
}

main().catch(console.error);
