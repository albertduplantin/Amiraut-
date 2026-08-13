import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LibraryForm } from "../LibraryForm";

export default async function NewLibraryClassPage() {
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }
  return <LibraryForm />;
}
