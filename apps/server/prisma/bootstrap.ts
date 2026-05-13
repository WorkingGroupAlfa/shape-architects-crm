import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function upsertDefaultStatuses() {
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
}

async function upsertTemplates() {
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
}

async function upsertUser(input: {
  name: string;
  email: string;
  role: 'ADMIN' | 'EMPLOYEE';
  password: string;
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      role: input.role,
      passwordHash: hashPassword(input.password),
      isActive: true
    },
    create: {
      name: input.name,
      email: input.email,
      role: input.role,
      passwordHash: hashPassword(input.password),
      isActive: true
    }
  });
}

async function upsertExecutor(input: { name: string; email: string; userId: string }) {
  const existing = await prisma.executor.findFirst({
    where: {
      OR: [
        { userId: input.userId },
        { email: input.email },
        { name: input.name }
      ]
    }
  });

  if (existing) {
    return prisma.executor.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        role: 'Executor',
        email: input.email,
        userId: input.userId
      }
    });
  }

  return prisma.executor.create({
    data: {
      name: input.name,
      role: 'Executor',
      email: input.email,
      userId: input.userId
    }
  });
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@shape.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'shape-admin-2026';
  const employeeOneEmail = process.env.SEED_EMPLOYEE_ONE_EMAIL || 'studio.one@shape.local';
  const employeeOnePassword = process.env.SEED_EMPLOYEE_ONE_PASSWORD || 'shape-studio-1';
  const employeeTwoEmail = process.env.SEED_EMPLOYEE_TWO_EMAIL || 'studio.two@shape.local';
  const employeeTwoPassword = process.env.SEED_EMPLOYEE_TWO_PASSWORD || 'shape-studio-2';

  await upsertDefaultStatuses();
  await upsertTemplates();

  const admin = await upsertUser({
    name: 'Shape Admin',
    email: adminEmail,
    role: 'ADMIN',
    password: adminPassword
  });

  const employeeOne = await upsertUser({
    name: 'Studio One',
    email: employeeOneEmail,
    role: 'EMPLOYEE',
    password: employeeOnePassword
  });

  const employeeTwo = await upsertUser({
    name: 'Studio Two',
    email: employeeTwoEmail,
    role: 'EMPLOYEE',
    password: employeeTwoPassword
  });

  await upsertExecutor({ name: 'STUDIO ONE', email: employeeOne.email, userId: employeeOne.id });
  await upsertExecutor({ name: 'STUDIO TWO', email: employeeTwo.email, userId: employeeTwo.id });

  await prisma.activityLog.create({
    data: {
      entityType: 'system',
      entityId: admin.id,
      action: 'bootstrap',
      message: 'Production bootstrap completed',
      userId: admin.id
    }
  });

  console.log('Production bootstrap completed.');
}

main()
  .catch(error => {
    console.error('Production bootstrap failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
