# Shape Architects CRM

Web CRM for Shape Architects studio operations: clients, projects, finances, calendar tasks, file storage, Gmail workflows, render reviews, invoices, offers, and staff project access.

## Stack

- React + Vite + TypeScript web app
- Express + TypeScript API
- Prisma + PostgreSQL
- TanStack Query, React Router, Recharts
- Gmail/mail workflows and scheduled campaigns
- Render-ready deployment

## Apps

- `apps/web` - CRM web interface
- `apps/server` - API, Prisma, storage, background workers
- `apps/landing` - public landing site and `/admin` editor

## Local Setup

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Default local ports:

- API: `http://localhost:4311`
- CRM: `http://localhost:5179`
- Landing: `http://localhost:5180`
- Landing admin: `http://localhost:5180/admin`

## Required Environment

Copy `apps/server/.env.example` to `apps/server/.env` and set:

- `DATABASE_URL`
- `AUTH_SECRET`
- `STORAGE_DIR`
- Gmail variables when mail sync is enabled

For Render, use the included `render.yaml` Blueprint. It creates PostgreSQL, API, CRM, and landing/admin services.

## Notes

- This is web-only. Electron, installers, desktop update flows, local SQLite backups, and release artifacts were intentionally removed.
- Seed creates one admin and two employee/executor users for initial access. Change passwords before production use.
