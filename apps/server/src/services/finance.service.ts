import { prisma } from '../lib/prisma.js';

export async function recalculateProjectFinancials(projectId: string) {
  const incomeEntries = await prisma.financeEntry.findMany({
    where: { projectId, type: 'income' }
  });
  const expenseEntries = await prisma.financeEntry.findMany({
    where: { projectId, type: 'expense' }
  });

  const income = incomeEntries.reduce((sum, item) => sum + item.amount, 0);
  const expense = expenseEntries.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = Number((income * 0.1).toFixed(2));
  const profit = Number((income - expense).toFixed(2));

  return prisma.project.update({
    where: { id: projectId },
    data: { income, expense, taxAmount, profit }
  });
}

export async function getFinanceSummary(year?: number) {
  const projects = await prisma.project.findMany({ include: { client: true } });

  if (year) {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd   = new Date(Date.UTC(year + 1, 0, 1));
    const dateFilter = { gte: yearStart, lt: yearEnd };

    // Match entries where dueDate falls in year OR dueDate is null but createdAt falls in year
    const entryDateFilter = {
      OR: [
        { dueDate: dateFilter },
        { dueDate: null, createdAt: dateFilter },
      ],
    };

    const [incomeEntries, expenseEntries, expected, overdue] = await Promise.all([
      prisma.financeEntry.findMany({ where: { type: 'income',  projectId: { not: null }, ...entryDateFilter } }),
      prisma.financeEntry.findMany({ where: { type: 'expense', projectId: { not: null }, ...entryDateFilter } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'EXPECTED', dueDate: dateFilter } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'OVERDUE',  dueDate: dateFilter } }),
    ]);

    const incomeMap  = new Map<string, number>();
    const expenseMap = new Map<string, number>();
    for (const e of incomeEntries)  if (e.projectId) incomeMap.set(e.projectId,  (incomeMap.get(e.projectId)  ?? 0) + e.amount);
    for (const e of expenseEntries) if (e.projectId) expenseMap.set(e.projectId, (expenseMap.get(e.projectId) ?? 0) + e.amount);

    const yearProjects = projects
      .filter(p => incomeMap.has(p.id) || expenseMap.has(p.id))
      .map(p => {
        const income  = incomeMap.get(p.id)  ?? 0;
        const expense = expenseMap.get(p.id) ?? 0;
        const taxAmount = Number((income * 0.1).toFixed(2));
        return { ...p, income, expense, taxAmount, profit: Number((income - expense).toFixed(2)) };
      });

    return {
      projects: yearProjects,
      totals: {
        income:           yearProjects.reduce((s, p) => s + p.income, 0),
        expense:          yearProjects.reduce((s, p) => s + p.expense, 0),
        tax:              yearProjects.reduce((s, p) => s + p.taxAmount, 0),
        profit:           yearProjects.reduce((s, p) => s + p.profit, 0),
        expectedPayments: expected._sum.amount ?? 0,
        overduePayments:  overdue._sum.amount  ?? 0,
      },
    };
  }

  const [expected, overdue] = await Promise.all([
    prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'EXPECTED' } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'OVERDUE'  } }),
  ]);

  return {
    projects,
    totals: {
      income:           projects.reduce((s, p) => s + p.income, 0),
      expense:          projects.reduce((s, p) => s + p.expense, 0),
      tax:              projects.reduce((s, p) => s + p.taxAmount, 0),
      profit:           projects.reduce((s, p) => s + p.profit, 0),
      expectedPayments: expected._sum.amount ?? 0,
      overduePayments:  overdue._sum.amount  ?? 0,
    },
  };
}
