"use client";
import Link from"next/link";import{createContext,useContext,useEffect,useState}from"react";import{usePathname}from"next/navigation";import{Activity,BedDouble,Bell,Boxes,CalendarDays,CircleDollarSign,ClipboardList,ClipboardPlus,FileChartColumn,Gauge,HeartPulse,LogOut,Menu,Pill,Settings,ShieldCheck,Stethoscope,UsersRound,X}from"lucide-react";import{signOut}from"@/app/login/actions";
const main=[["/","Dashboard",Gauge],["/patients","Patients",UsersRound],["/queue","Appointments & Queue",CalendarDays],["/clinical","Consultation",ClipboardPlus],["/clinical-registry","Clinical Registry",Stethoscope],["/admissions","Admission & Transfer",BedDouble],["/orders","Orders & Results",ClipboardList],["/pharmacy","Pharmacy",Pill],["/inventory","Inventory",Boxes],["/billing","Billing & Cashier",CircleDollarSign],["/reports","Reports",FileChartColumn]]as const;const admin=[["/administration","Administration",Settings],["/audit","Audit & Compliance",ShieldCheck]]as const;
const ShellContext=createContext(false);
export function AppShell({children}:{children:React.ReactNode}){
  const nested=useContext(ShellContext);
  const path=usePathname();
  const [navigationOpen,setNavigationOpen]=useState(false);
  useEffect(()=>{
    if(!navigationOpen)return;
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape")setNavigationOpen(false)};
    window.addEventListener("keydown",onKeyDown);
    return()=>window.removeEventListener("keydown",onKeyDown);
  },[navigationOpen]);
  if(nested)return <>{children}</>;
  const closeNavigation=()=>setNavigationOpen(false);
  return <ShellContext.Provider value={true}><div className="app-shell">
    {navigationOpen&&<button type="button" className="mobile-nav-backdrop" aria-label="Close navigation" onClick={closeNavigation}/>}
    <aside id="hospital-navigation" className={`sidebar ${navigationOpen?"mobile-nav-open":""}`}>
      <div className="sidebar-header"><Link href="/" className="brand" aria-label="Hospital ONE — go to dashboard" onClick={closeNavigation}><div className="brand-mark"><HeartPulse size={23}/></div><div><h1>Hospital ONE</h1><p>Infirmary Core MVP</p></div></Link><button type="button" className="icon-btn mobile-nav-close" aria-label="Close navigation" onClick={closeNavigation}><X size={19}/></button></div>
      <p className="nav-label">Patient operations</p><nav className="nav-list" aria-label="Patient operations">{main.map(([h,l,I])=><Link key={h} href={h} onClick={closeNavigation} aria-current={path===h?"page":undefined} className={`nav-item ${path===h?"active":""}`}><I size={16}/>{l}</Link>)}</nav>
      <p className="nav-label">Governance</p><nav className="nav-list" aria-label="Governance">{admin.map(([h,l,I])=><Link key={h} href={h} onClick={closeNavigation} aria-current={path===h?"page":undefined} className={`nav-item ${path===h?"active":""}`}><I size={16}/>{l}</Link>)}</nav>
      <div className="profile-card"><div className="avatar">HA</div><div><strong>Signed-in user</strong><span>Facility team member</span></div></div>
    </aside><main className="app-main"><header className="topbar"><div className="facility"><strong>Infirmary Pilot Facility</strong><span>Patient care operations · Philippine Time</span></div><div className="top-actions"><button type="button" className="icon-btn mobile-nav-toggle" aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="hospital-navigation" onClick={()=>setNavigationOpen(true)}><Menu size={19}/></button><button type="button" className="icon-btn" aria-label="Notifications"><Bell size={17}/></button><form action={signOut}><button className="icon-btn" aria-label="Log out"><LogOut size={17}/></button></form></div></header><div className="content">{children}</div></main>
  </div></ShellContext.Provider>
}
export function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:React.ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="subtext">{description}</p></div>{action}</div>}
export function DemoNotice(){return <div className="notice"><Activity size={16}/><div><strong>Safe demonstration workspace</strong>Synthetic records are shown until Supabase is connected. Do not enter live patient data here.</div></div>}
