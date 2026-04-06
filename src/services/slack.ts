/**
 * Slack API client — all Slack Web API interactions.
 */

import type { ISlackService, SlackMessage, SlackBlock } from '../types';

export interface SlackDeps {
  UrlFetchApp: GoogleAppsScript.URL_Fetch.UrlFetchApp;
  botToken: string;
}

export function createSlackService(deps: SlackDeps): ISlackService {
  const { UrlFetchApp: fetchApp, botToken } = deps;

  function slackApiCall(method: string, payload: Record<string, unknown>): unknown {
    const url = `https://slack.com/api/${method}`;
    const response = fetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { Authorization: `Bearer ${botToken}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    return JSON.parse(response.getContentText());
  }

  function postToResponseUrl(responseUrl: string, message: SlackMessage): boolean {
    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      payload: JSON.stringify(message),
      muteHttpExceptions: true,
    };

    try {
      const response = fetchApp.fetch(responseUrl, options);
      if (response.getResponseCode() !== 200) {
        logFailure(responseUrl, response.getResponseCode());
        return false;
      }
      return true;
    } catch (_e) {
      // Retry once
      try {
        const retry = fetchApp.fetch(responseUrl, options);
        return retry.getResponseCode() === 200;
      } catch (_retryErr) {
        logFailure(responseUrl, 0);
        return false;
      }
    }
  }

  function postToChannel(
    channelId: string,
    text: string,
    blocks?: SlackBlock[],
  ): unknown {
    const payload: Record<string, unknown> = { channel: channelId, text };
    if (blocks) payload.blocks = blocks;
    return slackApiCall('chat.postMessage', payload);
  }

  function sendDM(
    slackUserId: string,
    text: string,
    blocks?: SlackBlock[],
  ): unknown {
    const convResult = slackApiCall('conversations.open', {
      users: slackUserId,
    }) as { ok: boolean; channel?: { id: string } };
    if (!convResult.ok || !convResult.channel) return convResult;

    const payload: Record<string, unknown> = {
      channel: convResult.channel.id,
      text,
    };
    if (blocks) payload.blocks = blocks;
    return slackApiCall('chat.postMessage', payload);
  }

  function openModal(triggerId: string, view: Record<string, unknown>): unknown {
    return slackApiCall('views.open', { trigger_id: triggerId, view });
  }

  function updateMessage(responseUrl: string, message: SlackMessage): void {
    const payload = { ...message, replace_original: true };
    try {
      fetchApp.fetch(responseUrl, {
        method: 'post',
        contentType: 'application/json; charset=utf-8',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
    } catch (_e) {
      // Best effort
    }
  }

  function logFailure(url: string, code: number): void {
    if (typeof Logger !== 'undefined') {
      Logger.log(`Failed response_url POST: HTTP ${code} to ${url}`);
    }
  }

  /**
   * Get user's timezone offset from Slack users.info API.
   * Returns offset in milliseconds, or null if unavailable.
   */
  function getUserTimezoneOffset(slackUserId: string): number | null {
    try {
      const result = slackApiCall('users.info', { user: slackUserId }) as {
        ok: boolean;
        user?: { tz_offset?: number };
      };
      if (result.ok && result.user?.tz_offset !== undefined) {
        return result.user.tz_offset * 1000; // Slack returns seconds, we need ms
      }
    } catch (_e) {
      // Fall through to null
    }
    return null;
  }

  return { postToResponseUrl, postToChannel, sendDM, openModal, updateMessage, getUserTimezoneOffset };
}
