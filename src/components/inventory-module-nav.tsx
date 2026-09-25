import Link from "next/link";

const sections = [
  ["/inventory", "Medicine stock"],
  ["/operations/materials", "Materials stock"],
  ["/operations/purchasing", "Purchasing"],
] as const;

export function InventoryModuleNav({ current }: { current: (typeof sections)[number][0] }) {
  return <nav aria-label="Inventory modules" className="operation-tabs inventory-module-nav">
    {sections.map(([href, label]) => <Link key={href} href={href} aria-current={current === href ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
