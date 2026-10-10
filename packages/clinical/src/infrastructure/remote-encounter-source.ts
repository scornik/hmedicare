import { AppError } from '@hmedic/kernel';
import { type Tx, lockRow } from '@hmedic/database';

/** Clinical owner gate. Remote transport never changes or completes the encounter. */
export class RemoteEncounterSource {
  async lock(tx: Tx, tenantId: string, encounterId: string, active = true) {
    const snapshot = await tx.encounter.findFirst({ where: { tenantId, id: encounterId } });
    if (!snapshot) throw new AppError('RESOURCE_NOT_FOUND');
    if (!(await lockRow(tx, 'patients', snapshot.patientId, tenantId)))
      throw new AppError('RESOURCE_NOT_FOUND');
    if (!(await tx.patient.count({ where: { tenantId, id: snapshot.patientId, status: 'ACTIVE' } })))
      throw new AppError('FORBIDDEN');
    if (!(await lockRow(tx, 'encounters', encounterId, tenantId))) throw new AppError('RESOURCE_NOT_FOUND');
    const encounter = await tx.encounter.findFirstOrThrow({ where: { tenantId, id: encounterId } });
    if (encounter.careMode !== 'REMOTE' || (active && encounter.status !== 'IN_PROGRESS'))
      throw new AppError('INVALID_TRANSITION');
    return { id: encounter.id, patientId: encounter.patientId, status: encounter.status };
  }
}
