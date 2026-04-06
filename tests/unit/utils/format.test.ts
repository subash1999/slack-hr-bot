import {
  ephemeralText, inChannelText, errorResponse, successResponse,
  attendancePublicMessage, formatHoursMinutes,
} from '../../../src/utils/format';

describe('Format Utilities', () => {
  describe('ephemeralText', () => {
    it('creates ephemeral message', () => {
      expect(ephemeralText('hello')).toEqual({ response_type: 'ephemeral', text: 'hello' });
    });
  });

  describe('inChannelText', () => {
    it('creates in_channel message', () => {
      expect(inChannelText('hello')).toEqual({ response_type: 'in_channel', text: 'hello' });
    });
  });

  describe('errorResponse', () => {
    it('prefixes with cross mark', () => {
      const result = errorResponse('Something failed');
      expect(result.text).toContain('Something failed');
      expect(result.response_type).toBe('ephemeral');
    });
  });

  describe('successResponse', () => {
    it('prefixes with check mark', () => {
      const result = successResponse('Done');
      expect(result.text).toContain('Done');
      expect(result.response_type).toBe('ephemeral');
    });
  });

  describe('attendancePublicMessage', () => {
    it('creates public clock in message', () => {
      const msg = attendancePublicMessage('Alex', 'IN', '09:00');
      expect(msg.text).toBe('Alex clocked in at 09:00');
      expect(msg.response_type).toBe('in_channel');
    });
    it('creates break message', () => {
      const msg = attendancePublicMessage('Alex', 'BREAK_START', '12:00');
      expect(msg.text).toBe('Alex started a break at 12:00');
    });
  });

  describe('formatHoursMinutes', () => {
    it('formats hours and minutes', () => {
      expect(formatHoursMinutes(3.5)).toBe('3h 30m');
    });
    it('formats zero hours', () => {
      expect(formatHoursMinutes(0.25)).toBe('15m');
    });
    it('formats whole hours', () => {
      expect(formatHoursMinutes(3)).toBe('3h');
    });
    it('formats zero', () => {
      expect(formatHoursMinutes(0)).toBe('0m');
    });
  });
});
