export interface CommunicationRecipientSource<Transaction> {
  validContact(
    tx: Transaction,
    tenantId: string,
    patientId: string,
    channel: 'email' | 'whatsapp',
    id: string,
  ): Promise<boolean>;
  resolve(
    tx: Transaction,
    tenantId: string,
    patientId: string,
    channel: 'email' | 'whatsapp',
    contactId?: string | null,
  ): Promise<{
    consentId: string;
    consentVersion: number;
    contactId: string;
    destination: string;
  } | null>;
}
export interface CommunicationReminderSource<Transaction> {
  eligible(
    tx: Transaction,
    tenantId: string,
    patientId: string,
    planId: string,
    task?: { id: string; rowVersion: number },
  ): Promise<boolean>;
}
