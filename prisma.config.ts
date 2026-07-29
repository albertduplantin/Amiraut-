import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need a direct (non-pooled) connection; runtime queries use
    // the pooled DATABASE_URL via lib/prisma.ts instead.
    url: process.env["POSTGRES_URL_NON_POOLING"] || process.env["DATABASE_URL"],
  },
});
