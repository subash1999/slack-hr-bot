import { createAuthService } from '../../../src/auth';
import { createMockSheetsService } from '../../mocks/gas-mocks';
import { DEFAULT_EMPLOYEES, buildEmployeesData } from '../../fixtures/employees';
import { TABS } from '../../../src/config';

function makeAuth(employeesData = DEFAULT_EMPLOYEES) {
  const sheets = createMockSheetsService({ [TABS.EMPLOYEES]: employeesData });
  return createAuthService({ sheetsService: sheets, verificationToken: 'test-token' });
}

describe('Auth Service', () => {
  describe('verifyToken', () => {
    it('passes with matching token', () => {
      const auth = makeAuth();
      expect(auth.verifyToken({ token: 'test-token' })).toBe(true);
    });

    it('throws on mismatched token', () => {
      const auth = makeAuth();
      expect(() => auth.verifyToken({ token: 'wrong' })).toThrow('verification token mismatch');
    });

    it('passes when no verification token configured', () => {
      const sheets = createMockSheetsService({ [TABS.EMPLOYEES]: DEFAULT_EMPLOYEES });
      const auth = createAuthService({ sheetsService: sheets });
      expect(auth.verifyToken({ token: 'anything' })).toBe(true);
    });
  });

  describe('getRole', () => {
    it('resolves CEO as admin', () => {
      const auth = makeAuth();
      const caller = auth.getRole('UCEO001');
      expect(caller.role).toBe('admin');
      expect(caller.is_admin).toBe(true);
      expect(caller.user_id).toBe('EMP000');
    });

    it('resolves employee with is_admin=TRUE as admin', () => {
      const data = buildEmployeesData(
        ['EMP010', 'UADM01', 'Admin User', 'admin@test.com', 'CTO', 500000, '2026-01-01', 3, 1, 20, 'EMP000', 'TRUE', 0, 'ACTIVE'],
      );
      const auth = makeAuth(data);
      const caller = auth.getRole('UADM01');
      expect(caller.role).toBe('admin');
    });

    it('resolves user with direct reports as manager', () => {
      const auth = makeAuth();
      // EMP001 (UMGR001) is manager_id for EMP002 and EMP003
      const caller = auth.getRole('UMGR001');
      expect(caller.role).toBe('manager');
    });

    it('resolves regular employee', () => {
      const auth = makeAuth();
      const caller = auth.getRole('UEMP001');
      expect(caller.role).toBe('employee');
      expect(caller.name).toBe('Alex Dev');
    });

    it('throws for unregistered user', () => {
      const auth = makeAuth();
      expect(() => auth.getRole('UUNKNOWN')).toThrow("not registered");
    });

    it('throws for inactive user', () => {
      const auth = makeAuth();
      expect(() => auth.getRole('UINAC01')).toThrow('inactive');
    });

    it('includes all caller fields', () => {
      const auth = makeAuth();
      const caller = auth.getRole('UEMP001');
      expect(caller).toMatchObject({
        user_id: 'EMP002',
        slack_id: 'UEMP001',
        name: 'Alex Dev',
        email: 'alex@example.com',
        position: 'Full Time Developer',
        manager_id: 'EMP001',
        salary: 350000,
        status: 'ACTIVE',
      });
    });
  });

  describe('requireRole', () => {
    it('passes when role meets minimum', () => {
      const auth = makeAuth();
      const admin = auth.getRole('UCEO001');
      expect(auth.requireRole(admin, 'employee')).toBe(admin);
      expect(auth.requireRole(admin, 'manager')).toBe(admin);
      expect(auth.requireRole(admin, 'admin')).toBe(admin);
    });

    it('manager passes for employee and manager commands', () => {
      const auth = makeAuth();
      const mgr = auth.getRole('UMGR001');
      expect(auth.requireRole(mgr, 'employee')).toBe(mgr);
      expect(auth.requireRole(mgr, 'manager')).toBe(mgr);
    });

    it('employee fails for manager commands', () => {
      const auth = makeAuth();
      const emp = auth.getRole('UEMP001');
      expect(() => auth.requireRole(emp, 'manager')).toThrow('managers only');
    });

    it('employee fails for admin commands', () => {
      const auth = makeAuth();
      const emp = auth.getRole('UEMP001');
      expect(() => auth.requireRole(emp, 'admin')).toThrow('admins');
    });

    it('manager fails for admin commands', () => {
      const auth = makeAuth();
      const mgr = auth.getRole('UMGR001');
      expect(() => auth.requireRole(mgr, 'admin')).toThrow('admins');
    });
  });

  describe('canAccessEmployee', () => {
    it('admin can access any employee', () => {
      const auth = makeAuth();
      const admin = auth.getRole('UCEO001');
      expect(auth.canAccessEmployee(admin, 'EMP001')).toBe(true);
      expect(auth.canAccessEmployee(admin, 'EMP002')).toBe(true);
    });

    it('manager can access direct reports', () => {
      const auth = makeAuth();
      const mgr = auth.getRole('UMGR001');
      expect(auth.canAccessEmployee(mgr, 'EMP002')).toBe(true); // direct report
    });

    it('manager cannot access non-reports', () => {
      const auth = makeAuth();
      const mgr = auth.getRole('UMGR001');
      expect(auth.canAccessEmployee(mgr, 'EMP000')).toBe(false); // CEO is not a report
    });

    it('employee can only access self', () => {
      const auth = makeAuth();
      const emp = auth.getRole('UEMP001');
      expect(auth.canAccessEmployee(emp, 'EMP002')).toBe(true); // self
      expect(auth.canAccessEmployee(emp, 'EMP001')).toBe(false); // other
    });
  });
});
