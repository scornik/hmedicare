import { defineConfig } from 'prisma/config';

// Prisma 7 config (TECHNOLOGY-STACK.md §2). The datasource URL comes from DATABASE_URL at run time.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'mysql://unset:unset@127.0.0.1:3306/unset' },
});
