import Link from "next/link";

const sections = [
  ["/inventory?tab=overview", "Stock Overview"],
  ["/inventory?tab=beginning", "Beginning Balance"],
  ["/inventory?tab=receiving", "Receiving"],
  ["/inventory?tab=adjustments", "Adjustments"],
  ["/inventory?tab=transfers", "Transfers"],
  ["/inventory?tab=stock-card", "Stock Card"],
  ["/inventory?tab=suppliers", "Suppliers"],
  ["/operations/materials", "Materials Stock"],
  ["/operations/purchasing", "Purchasing"],
] as const;

export function InventoryModuleNav({ current }: { current: "/operations/materials" | "/operations/purchasing" }) {
  return <nav aria-label="Inventory sections" className="inventory-tabs">
    {sections.map(([href, label]) => <Link key={href} href={href} aria-current={current === href ? "page" : undefined} className={current === href ? "active" : ""}>{label}</Link>)}
  </nav>;
}

export function InventoryExtensionLinks() {
  return <>{sections.slice(-2).map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</>;
}
