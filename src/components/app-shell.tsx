"use client";
import Link from"next/link";import{createContext,useContext,useEffect,useState}from"react";import{usePathname}from"next/navigation";import{Activity,Baby,BedDouble,Bell,Boxes,CalendarDays,ChevronDown,CircleDollarSign,ClipboardList,ClipboardPlus,FileChartColumn,FileHeart,Gauge,HeartPulse,LogOut,Menu,Package,PackagePlus,Pill,Settings,ShieldCheck,Stethoscope,UsersRound,Utensils,X}from"lucide-react";import{signOut}from"@/app/login/actions";
const navigationGroups=[
  {label:"Patient Care",items:[["/dashboards/patient","Dashboard",Gauge],["/patients","Patients",UsersRound],["/queue","Appointments & Queue",CalendarDays],["/admissions","Admission & Transfer",BedDouble]]},
  {label:"Clinical Care",items:[["/dashboards/clinical","Dashboard",Gauge],["/clinical","Consultation",ClipboardPlus],["/clinical-registry","Clinical Registry",Stethoscope],["/orders","Orders & Results",ClipboardList],["/pharmacy","Pharmacy",Pill],["/operations/or","Operating Room",Activity],["/operations/dr","Delivery Room",Baby],["/operations/dietary","Dietary",Utensils]]},
  {label:"Materials & Supply Chain",items:[["/dashboards/materials","Dashboard",Gauge],["/inventory","Inventory Management",Boxes],["/operations/materials","Materials Management",Package],["/operations/purchasing","Purchasing & Procurement",PackagePlus]]},
  {label:"Revenue & Claims",items:[["/dashboards/revenue","Dashboard",Gauge],["/billing","Billing & Cashiering",CircleDollarSign],["/operations/philhealth","PhilHealth Claims",FileHeart]]},
  {label:"Reports & Analytics",items:[["/reports","Consolidated Reports",FileChartColumn],["/reports?view=executive","Executive Dashboard",Gauge],["/reports?view=operations","Operational Analytics",Activity],["/reports?view=disease","Clinical Analytics",Stethoscope],["/reports?view=revenue","Financial Analytics",CircleDollarSign],["/administration","Setup & Configuration",Settings],["/administration/reference-data","Libraries",ClipboardList],["/administration/roles","Security",ShieldCheck],["/audit","Audit & Compliance",ShieldCheck]]},
] as const;
const ShellContext=createContext(false);
export function AppShell({children}:{children:React.ReactNode}){
  const nested=useContext(ShellContext);
  const path=usePathname();
  const [navigationOpen,setNavigationOpen]=useState(false);
  const [expandedGroups,setExpandedGroups]=useState<Record<string,boolean>>({});
  const [reportView,setReportView]=useState("");
  const activeGroup=navigationGroups.find(group=>group.items.some(([href])=>{const route=href.split("?")[0];return path===route||path.startsWith(`${route}/`)}))?.label??"Patient Care";
  useEffect(()=>{const syncView=()=>setReportView(new URLSearchParams(window.location.search).get("view")||"");syncView();window.addEventListener("popstate",syncView);return()=>window.removeEventListener("popstate",syncView)},[path]);
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
      <div className="sidebar-navigation">{navigationGroups.map((group,index)=>{const expanded=expandedGroups[group.label]??activeGroup===group.label;const listId=`hospital-nav-group-${index}`;return <div className="nav-group" key={group.label}><button type="button" className="nav-group-toggle" aria-expanded={expanded} aria-controls={listId} onClick={()=>setExpandedGroups(current=>({...current,[group.label]:!(current[group.label]??activeGroup===group.label)}))}><span>{group.label}</span><ChevronDown size={15} aria-hidden="true"/></button><nav id={listId} className="nav-list" aria-label={group.label} hidden={!expanded}>{group.items.map(([href,label,Icon])=>{const view=href.includes("?")?href.split("view=")[1]:"";const active=path===href.split("?")[0]&&(path!=="/reports"||reportView===view);return <Link key={href} href={href} onClick={()=>{setReportView(view);setExpandedGroups(current=>({...current,[group.label]:true}));closeNavigation()}} aria-current={active?"page":undefined} className={`nav-item ${active?"active":""}`}><Icon size={16}/>{label}</Link>})}</nav></div>})}</div>
      <div className="profile-card"><div className="avatar">HA</div><div><strong>Signed-in user</strong><span>Facility team member</span></div></div>
    </aside><main className="app-main"><header className="topbar"><div className="facility"><strong>Infirmary Pilot Facility</strong><span>Patient care operations · Philippine Time</span></div><div className="top-actions"><button type="button" className="icon-btn mobile-nav-toggle" aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="hospital-navigation" onClick={()=>setNavigationOpen(true)}><Menu size={19}/></button><button type="button" className="icon-btn" aria-label="Notifications"><Bell size={17}/></button><form action={signOut}><button className="icon-btn" aria-label="Log out"><LogOut size={17}/></button></form></div></header><div className="content">{children}</div></main>
  </div></ShellContext.Provider>
}
export function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:React.ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="subtext">{description}</p></div>{action}</div>}
export function DemoNotice(){return <div className="notice"><Activity size={16}/><div><strong>Safe demonstration workspace</strong>Synthetic records are shown until Supabase is connected. Do not enter live patient data here.</div></div>}
