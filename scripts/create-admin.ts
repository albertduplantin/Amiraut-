import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const prenom = process.env.ADMIN_PRENOM ?? "Admin";
  const nom = process.env.ADMIN_NOM ?? "Hexagone";

  if (!email || !password) {
    console.error("Définis ADMIN_EMAIL et ADMIN_PASSWORD avant de lancer ce script.");
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { password: hashed, role: "ADMIN" },
    create: {
      email: email.toLowerCase(),
      password: hashed,
      prenom,
      nom,
      role: "ADMIN",
    },
  });

  console.log(`Compte admin prêt : ${user.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
