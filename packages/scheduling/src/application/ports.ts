import type { TenantContext } from '@hmedic/kernel';
import type { PatientContextActor } from '@hmedic/patient';
import type { CareMode } from '../domain/booking-rules';
import type { QueuePolicy } from '../domain/queue-policy';

/** Staff actor for scheduling use cases (membership-backed tenant context + request correlation). */
export interface SchedulingActor {
  userId: string;
  tenant: TenantContext;
  requestId?: string;
  correlationId?: string;
}

/** Either a staff member or a patient user acting through a patient context (AUTHORIZATION-MATRIX §4). */
export type BookingActor =
  { kind: 'staff'; actor: SchedulingActor } | { kind: 'patient'; context: PatientContextActor };

export type QueueActorType = 'USER' | 'PATIENT_CONTEXT' | 'SYSTEM';

export interface QueueActorRef {
  userId: string | null;
  actorType: QueueActorType;
  /**
   * On-behalf auditing (AUTHORIZATION-MATRIX §3): every action a patient context drives records who acted
   * and for which patient, so `actor_type = PATIENT_CONTEXT` alone is never the whole answer.
   */
  actingAs?: 'SELF' | 'GUARDIAN' | null;
  onBehalfOfPatientId?: string | null;
}

/** Chamber-day facts handed to the queue context inside a scheduling transaction. */
export interface ChamberDayFacts {
  id: string;
  tenantId: string;
  chamberId: string;
  doctorProfileId: string;
  localDate: string;
  localStartTime: string;
  localEndTime: string;
  status: string;
  policy: QueuePolicy;
  nextSerialNumber: number;
  queueOrderVersion: number;
  expectedDelayMinutes: number | null;
}

export interface IssueSerialForAppointmentInput {
  day: ChamberDayFacts;
  appointmentId: string;
  patientId: string;
  careMode: CareMode;
  source: 'ADVANCE_BOOKING' | 'FOLLOW_UP' | 'RESCHEDULE';
  rescheduledFromSerialId?: string | null;
  actor: QueueActorRef;
  correlationId: string;
  idempotencyKey?: string | null;
}

export interface IssuedSerial {
  serialId: string;
  serialNumber: number;
}

export interface SettledSerial {
  serialId: string;
  appointmentId: string | null;
  fromStatus: string;
  toStatus: 'NO_SHOW' | 'CANCELLED';
}

/**
 * Serial operations owned by the queue context (QUEUE §5.2, §3.3) and called by the scheduling services
 * inside their own transaction after the chamber day row is locked (lock rank 40 → 44). `TTx` is the
 * persistence transaction handle (opaque here, as in AuditPort).
 */
export interface SerialPort<TTx = unknown> {
  /** Allocates the next serial number under the day lock and inserts a BOOKED serial (SERIAL_ISSUED). */
  issueForAppointment(tx: TTx, input: IssueSerialForAppointmentInput): Promise<IssuedSerial>;
  /** Cancels the appointment's non-terminal serial (if any) with the reason; returns its id. */
  cancelForAppointment(
    tx: TTx,
    input: {
      day: ChamberDayFacts;
      appointmentId: string;
      reason: string;
      actor: QueueActorRef;
      correlationId: string;
    },
  ): Promise<string | null>;
  /** Per-source counts of non-cancelled serials on a day (capacity checks under the day lock). */
  countsForDay(
    tx: TTx,
    tenantId: string,
    chamberDayId: string,
  ): Promise<{ nonCancelled: number; booked: number; walkIns: number }>;
  /** True when any serial of the day is IN_CONSULTATION (CloseChamberDay refusal, QUEUE §3.3). */
  hasActiveConsultation(tx: TTx, tenantId: string, chamberDayId: string): Promise<boolean>;
  /** Applies the close disposition (CLOSE) or cancels (CANCEL) every non-terminal serial of the day. */
  settleDay(
    tx: TTx,
    input: { day: ChamberDayFacts; mode: 'CLOSE' | 'CANCEL'; actor: QueueActorRef; correlationId: string },
  ): Promise<SettledSerial[]>;
}

/**
 * Late-bound SerialPort. Scheduling and queue are mutually dependent at the composition root (a chamber day
 * settles serials; a serial reschedules through an appointment), so the root constructs this ref first,
 * hands it to the scheduling services and binds the queue implementation once it exists. Calling an unbound
 * ref is a wiring bug, not a runtime condition.
 */
export class SerialPortRef<TTx = unknown> implements SerialPort<TTx> {
  private impl: SerialPort<TTx> | null = null;

  bind(impl: SerialPort<TTx>): void {
    this.impl = impl;
  }

  private get target(): SerialPort<TTx> {
    if (!this.impl) throw new Error('SerialPortRef used before bind()');
    return this.impl;
  }

  issueForAppointment(tx: TTx, input: IssueSerialForAppointmentInput): Promise<IssuedSerial> {
    return this.target.issueForAppointment(tx, input);
  }

  cancelForAppointment(
    tx: TTx,
    input: Parameters<SerialPort<TTx>['cancelForAppointment']>[1],
  ): Promise<string | null> {
    return this.target.cancelForAppointment(tx, input);
  }

  countsForDay(
    tx: TTx,
    tenantId: string,
    chamberDayId: string,
  ): Promise<{ nonCancelled: number; booked: number; walkIns: number }> {
    return this.target.countsForDay(tx, tenantId, chamberDayId);
  }

  hasActiveConsultation(tx: TTx, tenantId: string, chamberDayId: string): Promise<boolean> {
    return this.target.hasActiveConsultation(tx, tenantId, chamberDayId);
  }

  settleDay(tx: TTx, input: Parameters<SerialPort<TTx>['settleDay']>[1]): Promise<SettledSerial[]> {
    return this.target.settleDay(tx, input);
  }
}

/** Payments module presence (audit C-45): false throughout Stage 5. */
export interface PaymentsAvailabilityPort {
  paymentsAvailable(): boolean;
}
