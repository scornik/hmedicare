import { AppError, type StaffRole } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { AssignmentPolicy } from './assignment-policy';
import type { ClinicalActor } from './encounter-service';

/**
 * Who may touch a given encounter's clinical content, and on what footing (AUTHORIZATION-MATRIX §3 and
 * the "Encounter notes" and "Diagnoses" rows of §2).
 *
 * Two different footings, deliberately not collapsed into one boolean:
 *
 * - **A doctor is assigned.** Their own encounter, one they are covering inside the window, or the solo
 *   owner's. Assignment is about this patient and this consultation.
 * - **A nurse is in scope.** The matrix grants nurses "C/R/U draft permitted sections (scope)" and "no
 *   sign": a nurse working in a chamber may help write the note there, and may never sign it. Scope is
 *   about where they work, not about who the patient is.
 *
 * Keeping them apart is what lets `sign` demand assignment while `saveDraft` accepts either. Folding them
 * into one flag would quietly let a nurse sign, or lock a nurse out of the chamber they staff.
 */

/**
 * The roles whose matrix cell grants them clinical *content* on a scope footing, from the "Encounter
 * notes" and "Diagnoses" rows of AUTHORIZATION-MATRIX §2.
 *
 * A receptionist is deliberately absent. They hold `encounter.read` because the Encounters row gives them
 * "R status only" — where the patient is in the day — and the notes row gives them nothing at all. The
 * permission and the content are two different questions, and gating a note on `encounter.read` alone
 * would answer the second with the first: a receptionist would read the consultation.
 */
const SCOPED_CLINICAL_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'tenant_owner',
  'clinic_admin',
  'nurse',
]);
export type ClinicalFooting = 'assigned' | 'scoped';

export interface ClinicalAccess {
  footing: ClinicalFooting;
  encounter: { id: string; patientId: string; status: string; chamberId: string };
}

export class ClinicalAccessPolicy {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly assignment: AssignmentPolicy,
  ) {}

  /** The encounter, or `RESOURCE_NOT_FOUND` — which is also the answer for another tenant's encounter. */
  private async require(tenantId: string, encounterId: string) {
    const row = await this.prisma.encounter.findFirst({
      where: { tenantId, id: encounterId },
      select: { id: true, patientId: true, status: true, chamberId: true },
    });
    if (!row) throw new AppError('RESOURCE_NOT_FOUND');
    return row;
  }

  /**
   * Assignment only. Signing, amending and anything else that attaches a doctor's name to the record.
   */
  async assigned(actor: ClinicalActor, encounterId: string): Promise<ClinicalAccess> {
    const tenantId = actor.tenant.tenantId;
    const encounter = await this.require(tenantId, encounterId);
    const result = await this.assignment.isAssignedToEncounter(
      { tenantId, doctorProfileId: actor.doctorProfileId },
      encounterId,
    );
    if (!result.assigned) throw new AppError('FORBIDDEN');
    return { footing: 'assigned', encounter };
  }

  /**
   * Assignment, or a nurse working in the chamber. Used for reading and for draft writes.
   *
   * The scope fallback runs only when assignment fails, so a doctor is always reported as `assigned` even
   * if their membership happens to be scoped to that chamber too.
   */
  async assignedOrScoped(actor: ClinicalActor, encounterId: string): Promise<ClinicalAccess> {
    const tenantId = actor.tenant.tenantId;
    const encounter = await this.require(tenantId, encounterId);
    const result = await this.assignment.isAssignedToEncounter(
      { tenantId, doctorProfileId: actor.doctorProfileId },
      encounterId,
    );
    if (result.assigned) return { footing: 'assigned', encounter };
    // Scope is the *non-doctor* footing. A doctor is judged by assignment and nothing else: the matrix
    // gives their column "(asg)" and the nurse column "(scope)". Letting a doctor fall through to the
    // scope check would hand every unassigned doctor in the tenant the whole clinic's records, because
    // an empty scope list means "everywhere" — which is how most small clinics are configured.
    if (
      actor.doctorProfileId === null &&
      SCOPED_CLINICAL_ROLES.has(actor.tenant.role) &&
      (await this.inScope(actor, encounter.chamberId))
    ) {
      return { footing: 'scoped', encounter };
    }
    throw new AppError('FORBIDDEN');
  }

  /**
   * Membership clinic/chamber scope, the same rule the scheduling context applies (`assertChamberScope`).
   * Empty lists mean "every clinic and chamber in the tenant", which is how a small clinic's staff are
   * usually set up.
   */
  private async inScope(actor: ClinicalActor, chamberId: string): Promise<boolean> {
    const { chamberIds, clinicIds } = actor.tenant;
    if (chamberIds.length > 0 && !chamberIds.includes(chamberId)) return false;
    if (clinicIds.length === 0) return true;
    const chamber = await this.prisma.chamber.findFirst({
      where: { tenantId: actor.tenant.tenantId, id: chamberId },
      select: { clinicId: true },
    });
    return chamber !== null && clinicIds.includes(chamber.clinicId);
  }
}
