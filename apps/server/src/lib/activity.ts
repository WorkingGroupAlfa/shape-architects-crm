import { prisma } from './prisma.js';

export async function logActivity(params: {
  entityType: string;
  entityId: string;
  action: string;
  message: string;
  clientId?: string;
  userId?: string;
}) {
  await prisma.activityLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      message: params.message,
      clientId: params.clientId,
      userId: params.userId
    }
  });
}
