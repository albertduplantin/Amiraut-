import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";

const TABS = [
  { href: "/admin/sejour", label: "Séjour & tarifs" },
  { href: "/admin/programme", label: "Programme" },
  { href: "/admin/editos", label: "Editos" },
  { href: "/admin/jeux", label: "Jeux" },
  { href: "/admin/inscriptions", label: "Inscriptions" },
  { href: "/admin/statistiques", label: "Statistiques" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/connexion");
  if (session.role !== "ADMIN") redirect("/");

  return (
    <div className="container">
      <h1>Dashboard admin</h1>
      <nav className="tabs section">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
