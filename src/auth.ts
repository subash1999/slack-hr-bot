/**
 * Auth module — verification, role resolution, permission checks.
 */

import { TABS, EMP, CEO_USER_ID, STATUS, ROLES } from './config';
import type { CallerInfo, Role, IAuthService, ISheetsService, SheetData } from './types';

const ROLE_LEVEL: Record<Role, number> = {
  [ROLES.EMPLOYEE]: 1,
  [ROLES.MANAGER]: 2,
  [ROLES.ADMIN]: 3,
};

const ROLE_DENIAL_MESSAGES: Partial<Record<Role, string>> = {
  [ROLES.MANAGER]: 'This command is for managers only.',
  [ROLES.ADMIN]: 'Only admins can use this command.',
};

export interface AuthDeps {
  sheetsService: ISheetsService;
  verificationToken?: string;
}

export function createAuthService(deps: AuthDeps): IAuthService {
  const { sheetsService, verificationToken } = deps;

  function getEmployeesData(): SheetData {
    return sheetsService.getAll(TABS.EMPLOYEES);
  }

  function verifyToken(payload: { token: string }): boolean {
    if (verificationToken === undefined || verificationToken === '') return true;
    if (payload.token !== verificationToken) {
      throw new Error('Invalid request: verification token mismatch.');
    }
    return true;
  }

  function hasDirectReports(userId: string, data: SheetData): boolean {
    for (let i = 1; i < data.length; i++) {
      if (
        data[i][EMP.MANAGER_ID] === userId &&
        String(data[i][EMP.STATUS]).toUpperCase() === STATUS.ACTIVE
      ) {
        return true;
      }
    }
    return false;
  }

  function getRole(slackUserId: string): CallerInfo {
    const data = getEmployeesData();
    let empRow: SheetData[number] | null = null;
    let empRowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (data[i][EMP.SLACK_ID] === slackUserId) {
        empRow = data[i];
        empRowIndex = i;
        break;
      }
    }

    if (!empRow) {
      throw new Error("You're not registered in the HR system. Contact admin.");
    }

    const status = String(empRow[EMP.STATUS]).toUpperCase();
    if (status === STATUS.INACTIVE) {
      throw new Error('Your account is inactive. Contact admin.');
    }

    const userId = String(empRow[EMP.USER_ID]);
    const isAdmin =
      empRow[EMP.IS_ADMIN] === true ||
      empRow[EMP.IS_ADMIN] === 'TRUE' ||
      userId === CEO_USER_ID;

    let role: Role;
    if (isAdmin) {
      role = ROLES.ADMIN;
    } else if (hasDirectReports(userId, data)) {
      role = ROLES.MANAGER;
    } else {
      role = ROLES.EMPLOYEE;
    }

    return {
      user_id: userId,
      slack_id: slackUserId,
      name: String(empRow[EMP.NAME]),
      email: String(empRow[EMP.EMAIL]),
      role,
      position: String(empRow[EMP.POSITION]),
      manager_id: String(empRow[EMP.MANAGER_ID]),
      is_admin: isAdmin,
      status: status as CallerInfo['status'],
      salary: Number(empRow[EMP.SALARY]),
      join_date: String(empRow[EMP.JOIN_DATE]),
      leave_balance: Number(empRow[EMP.LEAVE_BALANCE] ?? 0),
      rowIndex: empRowIndex + 1,
    };
  }

  function requireRole(caller: CallerInfo, minimumRole: Role): CallerInfo {
    const callerLevel = ROLE_LEVEL[caller.role];
    const requiredLevel = ROLE_LEVEL[minimumRole];

    if (callerLevel < requiredLevel) {
      throw new Error(ROLE_DENIAL_MESSAGES[minimumRole] ?? 'Insufficient permissions.');
    }
    return caller;
  }

  function canAccessEmployee(caller: CallerInfo, targetUserId: string): boolean {
    if (caller.role === ROLES.ADMIN) return true;
    if (caller.role === ROLES.MANAGER) {
      const data = getEmployeesData();
      for (let i = 1; i < data.length; i++) {
        if (
          data[i][EMP.USER_ID] === targetUserId &&
          data[i][EMP.MANAGER_ID] === caller.user_id
        ) {
          return true;
        }
      }
      return false;
    }
    return caller.user_id === targetUserId;
  }

  return { verifyToken, getRole, requireRole, canAccessEmployee };
}
