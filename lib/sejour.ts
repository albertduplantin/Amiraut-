import { prisma } from "@/lib/prisma";

export async function getActiveSejour() {
  return prisma.sejour.findFirst({
    orderBy: { updatedAt: "desc" },
    include: {
      editos: { orderBy: { ordre: "asc" } },
      programme: { orderBy: [{ date: "asc" }, { ordre: "asc" }] },
      jeux: {
        orderBy: { debut: "asc" },
        include: { inscriptions: true, waitlist: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
}

export type ActiveSejour = NonNullable<Awaited<ReturnType<typeof getActiveSejour>>>;
