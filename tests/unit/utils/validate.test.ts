import { validateDateInput, validateDateRange, resolveEmployeeRef, validateSalary, validateUniqueField } from '../../../src/utils/validate';
import { DEFAULT_EMPLOYEES } from '../../fixtures/employees';
import { EMP } from '../../../src/config';

describe('Validation Utilities', () => {
  describe('validateDateInput', () => {
    it('accepts valid date', () => {
      expect(validateDateInput('2026-03-15')).toEqual({ valid: true, date: '2026-03-15' });
    });
    it('rejects empty string', () => {
      expect(validateDateInput('')).toEqual({ valid: false, error: 'Invalid date format. Use YYYY-MM-DD.' });
    });
    it('rejects invalid format', () => {
      expect(validateDateInput('03-15-2026')).toEqual({ valid: false, error: 'Invalid date format. Use YYYY-MM-DD.' });
    });
    it('trims whitespace', () => {
      expect(validateDateInput('  2026-03-15  ')).toEqual({ valid: true, date: '2026-03-15' });
    });
  });

  describe('validateDateRange', () => {
    it('accepts valid range', () => {
      const result = validateDateRange('2026-03-01', '2026-03-05');
      expect(result.valid).toBe(true);
    });
    it('accepts same date', () => {
      const result = validateDateRange('2026-03-01', '2026-03-01');
      expect(result.valid).toBe(true);
    });
    it('rejects reversed range', () => {
      const result = validateDateRange('2026-03-05', '2026-03-01');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('before or equal');
    });
  });

  describe('resolveEmployeeRef', () => {
    it('resolves Slack @mention', () => {
      const result = resolveEmployeeRef('<@UEMP001>', DEFAULT_EMPLOYEES);
      expect(result.found).toBe(true);
      expect(result.row![EMP.NAME]).toBe('Alex Dev');
    });

    it('resolves Slack @mention with display name', () => {
      const result = resolveEmployeeRef('<@UEMP001|alex>', DEFAULT_EMPLOYEES);
      expect(result.found).toBe(true);
    });

    it('resolves EMP-id', () => {
      const result = resolveEmployeeRef('EMP002', DEFAULT_EMPLOYEES);
      expect(result.found).toBe(true);
      expect(result.row![EMP.NAME]).toBe('Alex Dev');
    });

    it('resolves email', () => {
      const result = resolveEmployeeRef('alex@example.com', DEFAULT_EMPLOYEES);
      expect(result.found).toBe(true);
      expect(result.row![EMP.USER_ID]).toBe('EMP002');
    });

    it('returns not found for unknown Slack ID', () => {
      const result = resolveEmployeeRef('<@UUNKNOWN>', DEFAULT_EMPLOYEES);
      expect(result.found).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error for empty input', () => {
      const result = resolveEmployeeRef('', DEFAULT_EMPLOYEES);
      expect(result.found).toBe(false);
    });

    it('returns error for invalid format', () => {
      const result = resolveEmployeeRef('randomtext', DEFAULT_EMPLOYEES);
      expect(result.found).toBe(false);
      expect(result.error).toContain('Invalid employee reference');
    });
  });

  describe('validateSalary', () => {
    it('accepts positive number', () => {
      expect(validateSalary(400000)).toEqual({ valid: true, salary: 400000 });
    });
    it('rejects zero', () => {
      expect(validateSalary(0).valid).toBe(false);
    });
    it('rejects negative', () => {
      expect(validateSalary(-100).valid).toBe(false);
    });
    it('rejects NaN', () => {
      expect(validateSalary('abc').valid).toBe(false);
    });
  });

  describe('validateUniqueField', () => {
    it('returns true when value is unique', () => {
      expect(validateUniqueField('NEW_ID', EMP.SLACK_ID, DEFAULT_EMPLOYEES)).toBe(true);
    });
    it('returns false when duplicate exists', () => {
      expect(validateUniqueField('UEMP001', EMP.SLACK_ID, DEFAULT_EMPLOYEES)).toBe(false);
    });
    it('allows duplicate when excluding the same row', () => {
      expect(validateUniqueField('UEMP001', EMP.SLACK_ID, DEFAULT_EMPLOYEES, 3)).toBe(true);
    });
  });
});
