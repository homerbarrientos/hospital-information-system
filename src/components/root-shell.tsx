"use client";
import{usePathname}from"next/navigation";import{AppShell}from"@/components/app-shell";
export function RootShell({children}:{children:React.ReactNode}){const path=usePathname();if(path.startsWith("/login")||path.startsWith("/auth"))return children;return <AppShell>{children}</AppShell>}
