import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { LibraryForm } from "../../LibraryForm";
import { DeleteButton } from "./DeleteButton";

export default async function EditLibraryClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }

  const libClass = await prisma.libraryUnitClass.findUnique({ where: { id } });
  if (!libClass) notFound();

  return (
    <>
      <LibraryForm initial={libClass} />
      <div className="mx-auto max-w-3xl px-6 pb-10">
        <DeleteButton id={id} name={libClass.name} />
      </div>
    </>
  );
}
