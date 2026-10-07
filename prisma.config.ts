import "dotenv/config";
import { defineConfig } from "prisma/config";

// dotenv does not override variables that are already set, so CI / test runs can inject DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
});
