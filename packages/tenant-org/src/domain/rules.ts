import { ROLE_PERMISSIONS, type TenantPermission } from '@hmedic/identity-access';

/**
 * A SOLO tenant's owner is a doctor (AUTHORIZATION-MATRIX §3 rule 5). The membership keeps role `doctor`
 * (so clinical approvals stay doctor-only) plus explicit grants of every tenant-owner permission the doctor
 * role lacks. Recorded as grants, so audits and the matrix stay explainable.
 */
export function soloOwnerGrants(): TenantPermission[] {
  const doctor = new Set<string>(ROLE_PERMISSIONS.doctor);
  return ROLE_PERMISSIONS.tenant_owner.filter((p) => !doctor.has(p));
}

export interface CoverageWindowProblem {
  path: string;
  code: string;
}

/** DATABASE-IMPLEMENTATION §3.2 `doctor_coverages`: ends after starts, max COVERAGE_MAX_DAYS, distinct doctors. */
export function validateCoverage(input: {
  coveredDoctorProfileId: string;
  coveringDoctorProfileId: string;
  startsAt: Date;
  endsAt: Date;
  maxDays: number;
  now: Date;
}): CoverageWindowProblem[] {
  const problems: CoverageWindowProblem[] = [];
  if (input.coveredDoctorProfileId === input.coveringDoctorProfileId) {
    problems.push({ path: 'coveringDoctorProfileId', code: 'same_doctor' });
  }
  if (input.endsAt <= input.startsAt) problems.push({ path: 'endsAt', code: 'before_start' });
  if (input.endsAt.getTime() - input.startsAt.getTime() > input.maxDays * 86_400_000) {
    problems.push({ path: 'endsAt', code: 'too_long' });
  }
  if (input.endsAt <= input.now) problems.push({ path: 'endsAt', code: 'in_past' });
  return problems;
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
