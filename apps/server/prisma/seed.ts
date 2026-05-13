import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function main() {
  const statuses = [
    { key: 'target', label: 'Target', isSystem: true },
    { key: 'not_target', label: 'Not Target', isSystem: true },
    { key: 'negotiations', label: 'Negotiations', isSystem: true }
  ];

  for (const status of statuses) {
    await prisma.clientStatus.upsert({
      where: { key: status.key },
      update: { label: status.label, isSystem: status.isSystem },
      create: status
    });
  }

  await prisma.emailTemplate.upsert({
    where: { id: 'welcome-template' },
    update: {
      name: 'Initial Contact',
      subject: 'Thank you for contacting Shape Architects',
      body: 'Hello, {{name}}!\n\nThank you for your request. We reviewed your inquiry and will get back to you shortly.'
    },
    create: {
      id: 'welcome-template',
      name: 'Initial Contact',
      subject: 'Thank you for contacting Shape Architects',
      body: 'Hello, {{name}}!\n\nThank you for your request. We reviewed your inquiry and will get back to you shortly.'
    }
  });

  await prisma.lead.deleteMany({
    where: {
      OR: [
        { name: 'Anna Grey' },
        { email: 'anna@grey.dev' }
      ]
    }
  });

  await prisma.client.deleteMany({
    where: {
      OR: [
        { name: 'Demo Client' },
        { email: 'demo@client.com' }
      ]
    }
  });

  await prisma.user.deleteMany({
    where: {
      email: {
        in: ['admin@shape.local', 'studio.one@shape.local', 'studio.two@shape.local']
      }
    }
  });

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@shape.local' },
    update: {
      name: 'Shape Admin',
      role: 'ADMIN',
      passwordHash: hashPassword('shape-admin-2026')
    },
    create: {
      name: 'Shape Admin',
      email: 'admin@shape.local',
      role: 'ADMIN',
      passwordHash: hashPassword('shape-admin-2026')
    }
  });

  const employeeUser = await prisma.user.upsert({
    where: { email: 'studio.one@shape.local' },
    update: {
      name: 'Studio One',
      role: 'EMPLOYEE',
      passwordHash: hashPassword('shape-studio-1')
    },
    create: {
      name: 'Studio One',
      email: 'studio.one@shape.local',
      role: 'EMPLOYEE',
      passwordHash: hashPassword('shape-studio-1')
    }
  });

  const yuliaUser = await prisma.user.upsert({
    where: { email: 'studio.two@shape.local' },
    update: {
      name: 'Studio Two',
      role: 'EMPLOYEE',
      passwordHash: hashPassword('shape-studio-2')
    },
    create: {
      name: 'Studio Two',
      email: 'studio.two@shape.local',
      role: 'EMPLOYEE',
      passwordHash: hashPassword('shape-studio-2')
    }
  });

  const existingExecutor = await prisma.executor.findFirst({
    where: {
      OR: [
        { userId: employeeUser.id },
        { email: 'studio.one@shape.local' },
        { name: 'STUDIO ONE' }
      ]
    }
  });

  if (existingExecutor) {
    await prisma.executor.update({
      where: { id: existingExecutor.id },
      data: {
        name: 'STUDIO ONE',
        role: 'Executor',
        email: 'studio.one@shape.local',
        userId: employeeUser.id
      }
    });
  } else {
    await prisma.executor.create({
      data: {
        name: 'STUDIO ONE',
        role: 'Executor',
        email: 'studio.one@shape.local',
        userId: employeeUser.id
      }
    });
  }

  const existingYuliaExecutor = await prisma.executor.findFirst({
    where: {
      OR: [
        { userId: yuliaUser.id },
        { email: 'studio.two@shape.local' },
        { name: 'STUDIO TWO' }
      ]
    }
  });

  if (existingYuliaExecutor) {
    await prisma.executor.update({
      where: { id: existingYuliaExecutor.id },
      data: {
        name: 'STUDIO TWO',
        role: 'Executor',
        email: 'studio.two@shape.local',
        userId: yuliaUser.id
      }
    });
  } else {
    await prisma.executor.create({
      data: {
        name: 'STUDIO TWO',
        role: 'Executor',
        email: 'studio.two@shape.local',
        userId: yuliaUser.id
      }
    });
  }

  await prisma.activityLog.create({
    data: {
      entityType: 'system',
      entityId: adminUser.id,
      action: 'seed',
      message: 'Seed updated with production-ready users and executors',
      userId: adminUser.id
    }
  });
}

main().finally(async () => {
  await prisma.$disconnect();
});
