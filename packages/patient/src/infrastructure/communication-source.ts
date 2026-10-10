import { type Tx, lockRow } from '@hmedic/database';

/** Internal owner port. Resolved contacts must stay in process, never in job/event payloads. */
export class PatientCommunicationSource {
  async validContact(
    tx: Tx,
    tenantId: string,
    patientId: string,
    channel: 'email' | 'whatsapp',
    id: string,
  ): Promise<boolean> {
    return (
      (await tx.patientContact.count({
        where: { id, tenantId, patientId, type: channel === 'email' ? 'EMAIL' : 'WHATSAPP' },
      })) === 1
    );
  }
  async resolve(
    tx: Tx,
    tenantId: string,
    patientId: string,
    channel: 'email' | 'whatsapp',
    contactId?: string | null,
  ) {
    if (!(await lockRow(tx, 'patients', patientId, tenantId))) return null;
    const patient = await tx.patient.findFirst({ where: { tenantId, id: patientId, status: 'ACTIVE' } });
    if (!patient) return null;
    const consent = await tx.patientConsent.findFirst({
      where: { tenantId, patientId, purpose: channel, status: 'GRANTED', withdrawnAt: null },
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    });
    if (!consent || !(await lockRow(tx, 'patient_consents', consent.id, tenantId))) return null;
    const current = await tx.patientConsent.findFirst({
      where: { id: consent.id, tenantId, patientId, status: 'GRANTED', withdrawnAt: null },
    });
    if (!current) return null;
    const contact = await tx.patientContact.findFirst({
      where: {
        tenantId,
        patientId,
        type: channel === 'email' ? 'EMAIL' : 'WHATSAPP',
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        verifiedAt: { not: null },
        ...(contactId ? { id: contactId } : {}),
      },
      orderBy: [{ isPreferred: 'desc' }, { id: 'asc' }],
    });
    if (!contact || !(await lockRow(tx, 'patient_contacts', contact.id, tenantId))) return null;
    const verified = await tx.patientContact.findFirst({
      where: {
        tenantId,
        id: contact.id,
        patientId,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        verifiedAt: { not: null },
      },
    });
    return verified
      ? {
          consentId: current.id,
          consentVersion: current.policyVersion,
          contactId: verified.id,
          destination: verified.normalizedValue,
        }
      : null;
  }
}
