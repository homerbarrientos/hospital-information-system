import Link from "next/link";
import { ArrowLeft, Package, PackagePlus } from "lucide-react";

const sections = [
  ["/operations/materials", "Materials stock", Package],
  ["/operations/purchasing", "Purchasing", PackagePlus],
] as const;

export function InventoryModuleNav({ current }: { current: (typeof sections)[number][0] }) {
  return <nav aria-label="Inventory actions" className="inventory-actions">
    <Link href="/inventory" className="btn btn-secondary"><ArrowLeft size={15}/>Inventory overview</Link>
    {sections.map(([href, label, Icon]) => <Link key={href} href={href} aria-current={current === href ? "page" : undefined} className={`btn ${current === href ? "btn-primary" : "btn-secondary"}`}><Icon size={15}/>{label}</Link>)}
  </nav>;
}

export function InventoryExtensionLinks() {
  return <>{sections.map(([href, label, Icon]) => <Link key={href} href={href} className="btn btn-secondary"><Icon size={15}/>{label}</Link>)}</>;
}
