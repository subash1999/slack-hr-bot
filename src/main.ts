/**
 * Main entry point — doPost() and routing.
 * This is the GAS web app entry point.
 */

import { createSheetsService } from './services/sheets';
import { createSlackService } from './services/slack';
import { createAuthService } from './auth';
import {
  handleClockIn,
  handleClockOut,
  handleBreakStart,
  handleBreakEnd,
  handleStatus,
} from './handlers/attendance';
import { handleCacheRefresh } from './handlers/cache';
import { handleFixSubmit, handleFixApproval } from './handlers/fix';
import { handleViewHours, handleBalance, handleMyBank, handlePayroll, handleHelp } from './handlers/hours';
import { handleLeaveRequest, handleTeamLeave } from './handlers/leave';
import { handleReport } from './handlers/report';
import { handleTeamHours, handleTeamFlags, handleTeamBank, handleTeamReports, handleTeamPayroll } from './handlers/manager';
import { ACTION_IDS, ROLES } from './config';
import { errorResponse, ephemeralText } from './utils/format';
import type { SlashCommandPayload, SlackMessage, BlockActionPayload, CallerInfo, ISlackService } from './types';

// These will be initialized on first doPost call
let _sheetsService: ReturnType<typeof createSheetsService>;
let _slackService: ISlackService;
let _authService: ReturnType<typeof createAuthService>;

function getServices(): {
  sheetsService: ReturnType<typeof createSheetsService>;
  slackService: ISlackService;
  authService: ReturnType<typeof createAuthService>;
} {
  if (_sheetsService === undefined) {
    const props = PropertiesService.getScriptProperties();
    _sheetsService = createSheetsService({
      SpreadsheetApp,
      CacheService,
      LockService,
      sheetId: props.getProperty('SHEET_ID') ?? '',
    });
    _slackService = createSlackService({
      UrlFetchApp,
      botToken: props.getProperty('SLACK_BOT_TOKEN') ?? '',
    });
    _authService = createAuthService({
      sheetsService: _sheetsService,
      verificationToken: props.getProperty('SLACK_VERIFICATION_TOKEN') ?? undefined,
    });
  }
  return { sheetsService: _sheetsService, slackService: _slackService, authService: _authService };
}

/**
 * GAS Web App entry point. Handles all Slack payloads.
 */
function doPost(
  e: GoogleAppsScript.Events.DoPost,
): GoogleAppsScript.Content.TextOutput {
  try {
    const { authService, sheetsService, slackService } = getServices();

    // Determine payload type
    if (e.parameter.command) {
      // Slash command
      const payload: SlashCommandPayload = {
        token: e.parameter.token,
        team_id: e.parameter.team_id,
        channel_id: e.parameter.channel_id,
        user_id: e.parameter.user_id,
        user_name: e.parameter.user_name,
        command: e.parameter.command,
        text: e.parameter.text || '',
        response_url: e.parameter.response_url,
        trigger_id: e.parameter.trigger_id,
      };

      authService.verifyToken(payload);
      const caller = authService.getRole(payload.user_id);

      const response = routeSlashCommand(
        payload,
        caller,
        { sheetsService, slackService, authService },
      );

      // Post real response to response_url
      slackService.postToResponseUrl(payload.response_url, response);

      // Return minimal ack
      return ContentService.createTextOutput('').setMimeType(
        ContentService.MimeType.JSON,
      );
    }

    if (e.parameter.payload) {
      // Interactive payload (buttons, modals)
      const payload = JSON.parse(e.parameter.payload) as Record<string, unknown>;
      const type = payload.type as string;

      if (type === 'block_actions') {
        const blockPayload = payload as unknown as BlockActionPayload;
        routeBlockAction(blockPayload, { sheetsService, slackService, authService });
      } else if (type === 'view_submission') {
        // TODO: Route to modal submission handlers (onboard, report, edit)
      }

      return ContentService.createTextOutput('').setMimeType(
        ContentService.MimeType.JSON,
      );
    }

    return ContentService.createTextOutput(
      JSON.stringify(errorResponse('Unknown request type.')),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
    return ContentService.createTextOutput(
      JSON.stringify(errorResponse(message)),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function routeSlashCommand(
  payload: SlashCommandPayload,
  caller: CallerInfo,
  deps: {
    sheetsService: ReturnType<typeof createSheetsService>;
    slackService: ISlackService;
    authService: ReturnType<typeof createAuthService>;
  },
): SlackMessage {
  const attendanceDeps = {
    sheetsService: deps.sheetsService,
    slackService: deps.slackService,
  };

  switch (payload.command) {
    // Attendance commands
    case '/in':
      return handleClockIn(caller, attendanceDeps);
    case '/out':
      return handleClockOut(caller, attendanceDeps);
    case '/break':
      return handleBreakStart(caller, attendanceDeps);
    case '/back':
      return handleBreakEnd(caller, attendanceDeps);
    case '/status':
    case '/clock-status':
      return handleStatus(caller, attendanceDeps);

    case '/cache-refresh':
      return handleCacheRefresh(caller, {
        sheetsService: deps.sheetsService,
        slackService: deps.slackService,
        authService: deps.authService,
      });

    case '/fix':
      return handleFixSubmit(caller, payload.text, {
        sheetsService: deps.sheetsService,
        slackService: deps.slackService,
      });

    // Self-service views
    case '/hours':
      return handleViewHours(caller, payload.text, { sheetsService: deps.sheetsService });
    case '/balance':
      return handleBalance(caller, { sheetsService: deps.sheetsService });
    case '/my-bank':
      return handleMyBank(caller, { sheetsService: deps.sheetsService });
    case '/payroll':
      return handlePayroll(caller, payload.text, { sheetsService: deps.sheetsService });
    case '/help':
    case '/hr-help':
      return handleHelp(caller, payload.text);

    // Leave
    case '/leave':
    case '/request-leave':
      return handleLeaveRequest(caller, payload.text, attendanceDeps);
    case '/team-leave':
      return handleTeamLeave(caller, payload.text, attendanceDeps);

    // Reports
    case '/report':
      return handleReport(caller, payload.text, attendanceDeps, payload.trigger_id);

    // Manager commands
    case '/team-hours': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      return handleTeamHours(caller, { sheetsService: deps.sheetsService });
    }
    case '/team-flags': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      return handleTeamFlags(caller, { sheetsService: deps.sheetsService });
    }
    case '/team-bank': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      return handleTeamBank(caller, { sheetsService: deps.sheetsService });
    }
    case '/team-reports': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      return handleTeamReports(caller, payload.text, { sheetsService: deps.sheetsService });
    }
    case '/team-payroll': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      return handleTeamPayroll(caller, payload.text, { sheetsService: deps.sheetsService });
    }
    case '/salary-history': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      // TODO: parse @employee and "set" subcommand
      return ephemeralText('Use: /salary-history @employee or /salary-history @employee set <amount> <type> <reason>');
    }
    case '/approve-surplus': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      // TODO: parse args
      return ephemeralText('Use: /approve-surplus @employee YYYY-MM hours max_leave_days');
    }
    case '/approve-absence': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      // TODO: parse args
      return ephemeralText('Use: /approve-absence @employee YYYY-MM-DD type reason');
    }
    case '/adjust-quota': {
      deps.authService.requireRole(caller, ROLES.MANAGER);
      // TODO: parse args and open modal
      return ephemeralText('Use: /adjust-quota @employee monthly|daily|weekly');
    }

    // Admin commands
    case '/onboard': {
      deps.authService.requireRole(caller, ROLES.ADMIN);
      // TODO: open modal with trigger_id
      return ephemeralText('Onboard modal coming soon. Use GAS editor for now.');
    }
    case '/offboard': {
      deps.authService.requireRole(caller, ROLES.ADMIN);
      // TODO: parse @employee
      return ephemeralText('Use: /offboard @employee');
    }
    case '/edit-employee': {
      deps.authService.requireRole(caller, ROLES.ADMIN);
      // TODO: parse @employee and open modal
      return ephemeralText('Use: /edit-employee @employee');
    }

    default:
      return ephemeralText(`Unknown command: ${payload.command}. Try /hr-help`);
  }
}

function routeBlockAction(
  payload: BlockActionPayload,
  deps: {
    sheetsService: ReturnType<typeof createSheetsService>;
    slackService: ISlackService;
    authService: ReturnType<typeof createAuthService>;
  },
): void {
  for (const action of payload.actions) {
    const actionId = action.action_id;

    if (actionId.startsWith(ACTION_IDS.FIX_APPROVE) || actionId.startsWith(ACTION_IDS.FIX_REJECT)) {
      const fixId = actionId.split(':')[1];
      const approved = actionId.startsWith(ACTION_IDS.FIX_APPROVE);
      const caller = deps.authService.getRole(payload.user.id);
      const result = handleFixApproval(caller.user_id, fixId, approved, {
        sheetsService: deps.sheetsService,
        slackService: deps.slackService,
      });

      // Update the original message with the result
      if (payload.response_url) {
        deps.slackService.updateMessage(payload.response_url, {
          text: result.text,
          replace_original: true,
        });
      }
    } else if (actionId.startsWith(ACTION_IDS.LEAVE_APPROVE) || actionId.startsWith(ACTION_IDS.LEAVE_REJECT)) {
      // Future leave approval routing — log for now
    } else {
      // Unknown action — ignore
    }
  }
}

/**
 * Keep-alive function — called every 5 minutes to prevent cold starts.
 */
function keepAlive(): void {
  // No-op
}

// Export for GAS global scope
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
(globalThis as Record<string, unknown>).doPost = doPost;
(globalThis as Record<string, unknown>).keepAlive = keepAlive;
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
