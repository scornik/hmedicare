import type { PrismaClient } from '@hmedic/database';

/**
 * Who counts as the assigned doctor (AUTHORIZATION-MATRIX §3). ADR-021 deferred this and let the interim
 * consultation transitions check only "is this the chamber's doctor", which is rule 2 and nothing else —
 * so a partner covering a sick colleague could not see the patient in front of them.
 *
 * The five rules live here once. Every clinical read and write asks this and nothing else, because a
 * second copy of an authorization rule is a second chance to get it wrong.
 */
export interface AssignmentActor {
  tenantId: string;
  /** The acting doctor's profile, when the actor is a doctor. Staff without one are never "assigned". */
  doctorProfileId: string | null;
}

export interface AssignmentResult {
  assigned: boolean;
  /**
   * Which rule allowed it, for the audit record and for tests that need to know *why* rather than just
   * that it passed. `coverage` additionally carries the grant, which the encounter stores.
   */
  via: 'encounter' | 'serial_or_appointment' | 'care_team' | 'coverage' | 'solo_owner' | null;
  coverage?: { id: string; coveredDoctorProfileId: string };
}

const DENIED: AssignmentResult = { assigned: false, via: null };

type Db = Pick<
  PrismaClient,
  | 'encounter'
  | 'serial'
  | 'appointment'
  | 'careTeamMember'
  | 'doctorCoverage'
  | 'tenant'
  | 'chamber'
  | 'chamberDay'
  | 'doctorProfile'
>;

export class AssignmentPolicy {
  constructor(
    private readonly prisma: Db,
    private readonly now: () => Date,
  ) {}

  /** Rule 5. Checked first because it is one indexed read and settles the common solo-practice case. */
  private async soloOwner(actor: AssignmentActor): Promise<boolean> {
    if (!actor.doctorProfileId) return false;
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: actor.tenantId },
      select: { practiceType: true, ownerDoctorProfileId: true },
    });
    return tenant?.practiceType === 'SOLO' && tenant.ownerDoctorProfileId === actor.doctorProfileId;
  }

  /** Rules 1–3 for one doctor and one patient. Coverage is deliberately not consulted here: rule 4 is
   * defined in terms of 1–3, and consulting it recursively is what would make coverage transitive. */
  private async directlyAssigned(
    tenantId: string,
    doctorProfileId: string,
    patientId: string,
  ): Promise<AssignmentResult> {
    const now = this.now();

    const encounter = await this.prisma.encounter.findFirst({
      where: { tenantId, doctorProfileId, patientId, status: { not: 'ENTERED_IN_ERROR' } },
      select: { id: true },
    });
    if (encounter) return { assigned: true, via: 'encounter' };

    // Rule 2 is about the chamber's doctor, not the encounter's: a patient booked into this doctor's
    // chamber is theirs to see, whatever has happened on the day so far.
    const chambers = await this.prisma.chamber.findMany({
      where: { tenantId, doctorProfileId },
      select: { id: true },
    });
    if (chambers.length > 0) {
      const chamberIds = chambers.map((c) => c.id);
      // The schema carries explicit foreign keys rather than Prisma relations, so the hop from chamber to
      // serial goes through chamber_days by hand.
      const days = await this.prisma.chamberDay.findMany({
        where: { tenantId, chamberId: { in: chamberIds } },
        select: { id: true },
      });
      const [serial, appointment] = await Promise.all([
        days.length === 0
          ? null
          : this.prisma.serial.findFirst({
              where: { tenantId, patientId, chamberDayId: { in: days.map((d) => d.id) } },
              select: { id: true },
            }),
        this.prisma.appointment.findFirst({
          where: { tenantId, patientId, chamberId: { in: chamberIds } },
          select: { id: true },
        }),
      ]);
      if (serial || appointment) return { assigned: true, via: 'serial_or_appointment' };
    }

    // A care team names the member by user, and assignment is asked about a doctor profile, so the
    // profile's user id is what links them.
    const profile = await this.prisma.doctorProfile.findFirst({
      where: { tenantId, id: doctorProfileId },
      select: { userId: true },
    });
    if (profile) {
      const careTeam = await this.prisma.careTeamMember.findFirst({
        where: {
          tenantId,
          patientId,
          role: 'DOCTOR',
          memberUserId: profile.userId,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        select: { id: true },
      });
      if (careTeam) return { assigned: true, via: 'care_team' };
    }

    return DENIED;
  }

  /** Rule 4: an active grant whose covered doctor is assigned by rules 1–3. Never chained. */
  private async viaCoverage(
    tenantId: string,
    coveringDoctorProfileId: string,
    patientId: string,
  ): Promise<AssignmentResult> {
    const now = this.now();
    const grants = await this.prisma.doctorCoverage.findMany({
      where: {
        tenantId,
        coveringDoctorProfileId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: { id: true, coveredDoctorProfileId: true },
    });
    for (const grant of grants) {
      const covered = await this.directlyAssigned(tenantId, grant.coveredDoctorProfileId, patientId);
      if (covered.assigned) {
        return {
          assigned: true,
          via: 'coverage',
          coverage: { id: grant.id, coveredDoctorProfileId: grant.coveredDoctorProfileId },
        };
      }
    }
    return DENIED;
  }

  async isAssignedToPatient(actor: AssignmentActor, patientId: string): Promise<AssignmentResult> {
    if (!actor.doctorProfileId) return DENIED;
    if (await this.soloOwner(actor)) return { assigned: true, via: 'solo_owner' };
    const direct = await this.directlyAssigned(actor.tenantId, actor.doctorProfileId, patientId);
    if (direct.assigned) return direct;
    return this.viaCoverage(actor.tenantId, actor.doctorProfileId, patientId);
  }

  /**
   * Assignment to a specific encounter: its own doctor, someone covering that doctor, or the solo owner.
   * Patient-level assignment is deliberately *not* enough — signing a note or approving a prescription
   * attaches a clinician's name to a specific consultation they must have been part of.
   */
  async isAssignedToEncounter(actor: AssignmentActor, encounterId: string): Promise<AssignmentResult> {
    if (!actor.doctorProfileId) return DENIED;
    const encounter = await this.prisma.encounter.findFirst({
      where: { tenantId: actor.tenantId, id: encounterId },
      select: { doctorProfileId: true, status: true },
    });
    if (!encounter) return DENIED;
    if (encounter.doctorProfileId === actor.doctorProfileId) return { assigned: true, via: 'encounter' };
    if (await this.soloOwner(actor)) return { assigned: true, via: 'solo_owner' };

    const now = this.now();
    const grant = await this.prisma.doctorCoverage.findFirst({
      where: {
        tenantId: actor.tenantId,
        coveringDoctorProfileId: actor.doctorProfileId,
        coveredDoctorProfileId: encounter.doctorProfileId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: { id: true, coveredDoctorProfileId: true },
    });
    return grant
      ? {
          assigned: true,
          via: 'coverage',
          coverage: { id: grant.id, coveredDoctorProfileId: grant.coveredDoctorProfileId },
        }
      : DENIED;
  }
}
