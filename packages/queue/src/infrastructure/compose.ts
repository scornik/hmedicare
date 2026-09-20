import type { Clock } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { PatientEvents, PatientService } from '@hmedic/patient';
import {
  AppointmentService,
  ChamberDayService,
  ChamberService,
  type PaymentsAvailabilityPort,
  ScheduleService,
  SchedulingEvents,
  SerialPortRef,
} from '@hmedic/scheduling';
import { QueueOutbox } from './events';
import { QueueService } from './queue-service';
import { SerialService } from './serial-service';

export interface QueueCompositionDeps {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  clock: Clock;
  /** Audit C-45: payments are absent throughout Stage 5, so the default refuses prepaid bookings. */
  payments?: PaymentsAvailabilityPort;
}

export interface SchedulingAndQueue {
  chambers: ChamberService;
  schedules: ScheduleService;
  days: ChamberDayService;
  appointments: AppointmentService;
  serials: SerialService;
  queue: QueueService;
}

/**
 * Composes the scheduling and queue contexts together (apps/api and apps/worker both need the pair). The
 * two are mutually dependent — a chamber day settles serials, a serial reschedules through an appointment —
 * so the SerialPort is handed over as a ref and bound once the serial engine exists.
 */
export function composeSchedulingAndQueue(deps: QueueCompositionDeps): SchedulingAndQueue {
  const { prisma, audit, clock } = deps;
  const events = new SchedulingEvents(new OutboxPort(clock), clock);
  const serialRef = new SerialPortRef<never>();
  const chambers = new ChamberService(prisma, audit, events, clock);
  const schedules = new ScheduleService(prisma, audit, events, chambers, clock);
  const days = new ChamberDayService(prisma, audit, events, chambers, schedules, serialRef, clock);
  const patients = new PatientService(prisma, audit, new PatientEvents(new OutboxPort(clock), clock), clock);
  const appointments = new AppointmentService(
    prisma,
    audit,
    events,
    chambers,
    days,
    serialRef,
    patients,
    deps.payments ?? { paymentsAvailable: () => false },
    clock,
  );
  const serials = new SerialService(
    prisma,
    audit,
    new QueueOutbox(new OutboxPort(clock), clock),
    appointments,
    clock,
  );
  serialRef.bind(serials as never);
  const queue = new QueueService(
    prisma,
    audit,
    new QueueOutbox(new OutboxPort(clock), clock),
    serials,
    patients,
    clock,
  );
  return { chambers, schedules, days, appointments, serials, queue };
}
