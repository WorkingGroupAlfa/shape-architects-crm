import dayjs from 'dayjs';
import { prisma } from '../lib/prisma.js';

export async function syncOverduePayments() {
  const now = new Date();
  await prisma.payment.updateMany({
    where: {
      status: 'EXPECTED',
      dueDate: { lt: now }
    },
    data: {
      status: 'OVERDUE'
    }
  });
}

export async function syncTaskNotifications() {
  const now = dayjs();

  const tasksInWindow = await prisma.calendarTask.findMany({
    where: {
      status: { in: ['TODO', 'POSTPONED'] },
      date: { lte: now.add(30, 'minute').toDate() }
    },
    include: { client: true, project: true }
  });

  const ensureTaskNotification = async (taskId: string, type: string, title: string, message: string) => {
    const existing = await prisma.notification.findFirst({
      where: { taskId, type }
    });

    if (existing) return;

    await prisma.notification.create({
      data: {
        taskId,
        type,
        title,
        message
      }
    });
  };

  for (const task of tasksInWindow) {
    const taskTime = dayjs(task.date);
    const trigger30m = taskTime.subtract(30, 'minute');
    const taskMeta = [task.client?.name, task.project?.title].filter(Boolean).join(' | ');

    if (now.isAfter(trigger30m) || now.isSame(trigger30m)) {
      await ensureTaskNotification(
        task.id,
        'task-reminder-30m',
        `Task in 30 minutes: ${task.title}`,
        taskMeta || 'The task requires your attention soon.'
      );
    }

    if (now.isAfter(taskTime) || now.isSame(taskTime)) {
      await ensureTaskNotification(
        task.id,
        'task-reminder-start',
        `Task start time: ${task.title}`,
        taskMeta || 'Task time has started.'
      );
    }
  }
}

