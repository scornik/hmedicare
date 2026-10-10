import { type PrismaClient, type Tx, lockRow, withTransaction } from '@hmedic/database';
import { type Clock, systemClock } from '@hmedic/kernel';

/** Internal source gate; no clinical prose leaves the follow-up context. */
export class FollowUpReminderSource {
  constructor(
    private readonly prisma?: PrismaClient,
    private readonly clock: Clock = systemClock,
  ) {}
  async eligible(
    tx: Tx,
    tenantId: string,
    patientId: string,
    planId: string,
    task?: { id: string; rowVersion: number },
  ): Promise<boolean> {
    if (!(await lockRow(tx, 'follow_up_plans', planId, tenantId))) return false;
    const plan = await tx.followUpPlan.findFirst({
      where: { tenantId, id: planId, patientId, status: { in: ['PLANNED', 'BOOKED'] } },
    });
    if (!plan) return false;
    const today = new Date(this.clock.now().getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (plan.dueStartDate.toISOString().slice(0, 10) > today) return false;
    if (task) {
      if (!(await lockRow(tx, 'follow_up_tasks', task.id, tenantId))) return false;
      if (
        !(await tx.followUpTask.count({
          where: {
            id: task.id,
            tenantId,
            followUpPlanId: planId,
            taskType: 'REMINDER',
            status: 'OPEN',
            rowVersion: task.rowVersion,
            dueAt: { lte: this.clock.now() },
          },
        }))
      )
        return false;
    }
    if (!(await lockRow(tx, 'encounters', plan.sourceEncounterId, tenantId))) return false;
    return (
      (await tx.encounter.count({
        where: { tenantId, id: plan.sourceEncounterId, patientId, status: { not: 'ENTERED_IN_ERROR' } },
      })) === 1
    );
  }
  async due(limit = 100) {
    if (!this.prisma) throw new Error('Reminder source requires a database for scanning');
    const tasks = await this.prisma.followUpTask.findMany({
      where: { status: 'OPEN', taskType: 'REMINDER', dueAt: { lte: this.clock.now() } },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, tenantId: true, followUpPlanId: true, rowVersion: true },
    });
    const results = [];
    for (const task of tasks) {
      const plan = await this.prisma.followUpPlan.findFirst({
        where: { id: task.followUpPlanId, tenantId: task.tenantId },
        select: { patientId: true },
      });
      if (plan) results.push({ ...task, patientId: plan.patientId });
    }
    return results;
  }
  async finish(taskId: string, tenantId: string, planId: string, rowVersion: number) {
    if (!this.prisma) throw new Error('Reminder source requires a database for finishing');
    return withTransaction(this.prisma, async (tx) => {
      await lockRow(tx, 'follow_up_plans', planId, tenantId);
      await lockRow(tx, 'follow_up_tasks', taskId, tenantId);
      return tx.followUpTask.updateMany({
        where: { id: taskId, tenantId, followUpPlanId: planId, rowVersion, status: 'OPEN' },
        data: { status: 'DONE', updatedAt: this.clock.now(), rowVersion: { increment: 1 } },
      });
    });
  }
}
