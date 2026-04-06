/**
 * Input validation utilities.
 */

import { isValidDateFormat } from './dates';
import { EMP, ID_PREFIX } from '../config';
import type { SheetData } from '../types';

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface DateValidation extends ValidationResult {
  date?: string;
}

interface DateRangeValidation extends ValidationResult {
  startDate?: string;
  endDate?: string;
}

interface EmployeeRefResult {
  found: boolean;
  error?: string;
  row?: SheetData[number];
  rowIndex?: number;
}

interface SalaryValidation extends ValidationResult {
  salary?: number;
}

export function validateDateInput(dateStr: string): DateValidation {
  if (!dateStr || typeof dateStr !== 'string') {
    return { valid: false, error: 'Invalid date format. Use YYYY-MM-DD.' };
  }
  const trimmed = dateStr.trim();
  if (!isValidDateFormat(trimmed)) {
    return { valid: false, error: 'Invalid date format. Use YYYY-MM-DD.' };
  }
  return { valid: true, date: trimmed };
}

export function validateDateRange(startStr: string, endStr: string): DateRangeValidation {
  const startResult = validateDateInput(startStr);
  if (!startResult.valid) return startResult;
  const endResult = validateDateInput(endStr);
  if (!endResult.valid) return endResult;
  if (startResult.date! > endResult.date!) {
    return { valid: false, error: 'Start date must be before or equal to end date.' };
  }
  return { valid: true, startDate: startResult.date, endDate: endResult.date };
}

export function resolveEmployeeRef(
  ref: string,
  employeesData: SheetData,
): EmployeeRefResult {
  if (!ref || typeof ref !== 'string') {
    return { found: false, error: 'Employee reference required.' };
  }
  const trimmed = ref.trim();

  // Slack @mention format: <@U04ABCDEF> or <@U04ABCDEF|name>
  const slackMention = trimmed.match(/^<@(U[A-Z0-9]+)(\|[^>]*)?>$/);
  if (slackMention) {
    const slackId = slackMention[1];
    for (let i = 1; i < employeesData.length; i++) {
      if (employeesData[i][EMP.SLACK_ID] === slackId) {
        return { found: true, row: employeesData[i], rowIndex: i };
      }
    }
    return { found: false, error: `Employee not found for Slack ID: ${slackId}` };
  }

  // EMP-id format
  if (new RegExp(`^${ID_PREFIX.EMPLOYEE}\\d+$`).test(trimmed)) {
    for (let i = 1; i < employeesData.length; i++) {
      if (employeesData[i][EMP.USER_ID] === trimmed) {
        return { found: true, row: employeesData[i], rowIndex: i };
      }
    }
    return { found: false, error: `Employee not found: ${trimmed}` };
  }

  // Email format
  if (trimmed.includes('@')) {
    for (let i = 1; i < employeesData.length; i++) {
      if (employeesData[i][EMP.EMAIL] === trimmed) {
        return { found: true, row: employeesData[i], rowIndex: i };
      }
    }
    return { found: false, error: `Employee not found with email: ${trimmed}` };
  }

  return { found: false, error: 'Invalid employee reference. Use @mention, email, or EMP-id.' };
}

export function validateSalary(salary: unknown): SalaryValidation {
  const num = Number(salary);
  if (isNaN(num) || num <= 0) {
    return { valid: false, error: 'Salary must be a positive number.' };
  }
  return { valid: true, salary: num };
}

export function validateUniqueField(
  value: unknown,
  fieldIndex: number,
  employeesData: SheetData,
  excludeRowIndex?: number,
): boolean {
  for (let i = 1; i < employeesData.length; i++) {
    if (i === excludeRowIndex) continue;
    if (employeesData[i][fieldIndex] === value) return false;
  }
  return true;
}
