import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orgCaps, canEditSystem, canInvite } from '../src/lib/permissions';

test('Ituti admin manages every client', () => {
  const c = orgCaps({ userRole: 'ITUTI_ADMIN', assigned: false, orgRole: null });
  assert.equal(c.view && c.manage && c.createSystems && c.deleteSystems && c.staff, true);
});

test('assessor sees only assigned clients', () => {
  assert.equal(orgCaps({ userRole: 'ITUTI_ASSESSOR', assigned: false, orgRole: null }).view, false);
  const c = orgCaps({ userRole: 'ITUTI_ASSESSOR', assigned: true, orgRole: null });
  assert.equal(c.view && c.manage && c.staff, true);
});

test('client admin manages own organisation but is not staff', () => {
  const c = orgCaps({ userRole: 'CLIENT', assigned: false, orgRole: 'CLIENT_ADMIN' });
  assert.equal(c.manage, true);
  assert.equal(c.staff, false);
});

test('contributor edits only assigned systems', () => {
  const c = orgCaps({ userRole: 'CLIENT', assigned: false, orgRole: 'CONTRIBUTOR' });
  assert.equal(c.view, true);
  assert.equal(c.manage, false);
  assert.equal(canEditSystem(c, false), false);
  assert.equal(canEditSystem(c, true), true);
});

test('viewer never edits', () => {
  const c = orgCaps({ userRole: 'CLIENT', assigned: false, orgRole: 'VIEWER' });
  assert.equal(c.view, true);
  assert.equal(canEditSystem(c, true), false);
});

test('outsider sees nothing', () => {
  const c = orgCaps({ userRole: 'CLIENT', assigned: false, orgRole: null });
  assert.equal(c.view, false);
});

test('only Ituti admins invite staff; managers invite client roles', () => {
  const admin = orgCaps({ userRole: 'ITUTI_ADMIN', assigned: false, orgRole: null });
  const clientAdmin = orgCaps({ userRole: 'CLIENT', assigned: false, orgRole: 'CLIENT_ADMIN' });
  const contributor = orgCaps({ userRole: 'CLIENT', assigned: false, orgRole: 'CONTRIBUTOR' });
  assert.equal(canInvite('ITUTI_ADMIN', null, 'ITUTI_ASSESSOR'), true);
  assert.equal(canInvite('ITUTI_ASSESSOR', admin, 'ITUTI_ADMIN'), false);
  assert.equal(canInvite('CLIENT', clientAdmin, 'ITUTI_ADMIN'), false);
  assert.equal(canInvite('CLIENT', clientAdmin, 'VIEWER'), true);
  assert.equal(canInvite('CLIENT', contributor, 'VIEWER'), false);
  assert.equal(canInvite('ITUTI_ADMIN', admin, 'SUPERUSER'), false);
});
