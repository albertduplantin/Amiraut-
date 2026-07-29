import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  prenom: z.string().trim().min(1),
  nom: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const secret = request.headers.get("x-setup-secret");
  if (!secret || secret !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { email, password, prenom, nom } = parsed.data;

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { password: await hashPassword(password), role: "ADMIN" },
    create: {
      email: email.toLowerCase(),
      password: await hashPassword(password),
      prenom,
      nom,
      role: "ADMIN",
    },
  });

  return NextResponse.json({ ok: true, email: user.email });
}
