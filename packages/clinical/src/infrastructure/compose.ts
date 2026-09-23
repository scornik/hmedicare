import { type Clock, systemClock } from '@hmedic/kernel';
import type { PrismaClient } from '@hmedic/database';
import type { PrismaAuditPort } from '@hmedic/audit';
import { OutboxPort } from '@hmedic/jobs';
import { QueueSerialLifecycle, type SerialService } from '@hmedic/queue';
import { AssignmentPolicy } from './assignment-policy';
import { EncounterService } from './encounter-service';
import { ClinicalOutbox } from './events';

/**
 * Builds the clinical context and closes the loop with the queue (Stage 6 CLIN-002).
 *
 * The two contexts need each other in opposite directions — clinical moves serials, and cancelling a
 * serial interrupts an encounter — which no import order can express. So the composition root builds
 * clinical on top of the queue's port and then hands the queue clinical's implementation of its own.
 * Neither package imports the other; this function knows about both.
 */
export function composeClinical(deps: {
  prisma: PrismaClient;
  audit: PrismaAuditPort;
  serials: SerialService;
  clock?: Clock;
}) {
  const clock = deps.clock ?? systemClock;
  const encounters = new EncounterService(
    deps.prisma,
    deps.audit,
    new ClinicalOutbox(new OutboxPort(clock), clock),
    new QueueSerialLifecycle(deps.serials),
    new AssignmentPolicy(deps.prisma, () => clock.now()),
    clock,
  );
  // Without this, cancelling a serial mid-consultation would leave an encounter that still looks live.
  deps.serials.attachEncounterInterruption(encounters);
  return { encounters };
}
