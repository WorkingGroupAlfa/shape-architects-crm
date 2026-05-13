import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async tx => {
    await tx.notification.deleteMany({});
    await tx.calendarTask.deleteMany({});
    await tx.payment.deleteMany({});
    await tx.financeEntry.deleteMany({});
    await tx.projectNote.deleteMany({});
    await tx.projectFile.deleteMany({});
    await tx.contractor.deleteMany({});
    await tx.project.deleteMany({});
    await tx.clientComment.deleteMany({});
    await tx.emailCampaignSubscription.deleteMany({});
    await tx.lead.deleteMany({});
    await tx.activityLog.deleteMany({});
    await tx.client.deleteMany({});
    await tx.executor.deleteMany({});
    await tx.emailTemplate.deleteMany({});
  });

  // Ensure default statuses exist after cleanup.
  const statuses = [
    { key: 'target', label: 'Target', isSystem: true },
    { key: 'not_target', label: 'Not Target', isSystem: true },
    { key: 'negotiations', label: 'Negotiations', isSystem: true }
  ];

  for (const status of statuses) {
    await prisma.clientStatus.upsert({
      where: { key: status.key },
      update: {},
      create: status
    });
  }

  console.log('Database cleanup completed.');
}

main()
  .catch(error => {
    console.error('Database cleanup failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
