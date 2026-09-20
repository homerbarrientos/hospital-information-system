const TZ="Asia/Manila";
const dateTime=new Intl.DateTimeFormat("en-PH",{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true,timeZone:TZ});
export const formatPhilippineDateTime=(value:string|Date)=>dateTime.format(new Date(value));
export function philippineDateKey(value:string|Date=new Date()){const p=new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:TZ}).formatToParts(new Date(value));const get=(t:Intl.DateTimeFormatPartTypes)=>p.find(x=>x.type===t)?.value||"";return `${get("year")}-${get("month")}-${get("day")}`}
