const TZ="Asia/Manila";
const phDateTime=new Intl.DateTimeFormat("en-PH",{dateStyle:"medium",timeStyle:"short",timeZone:TZ});
const phDate=new Intl.DateTimeFormat("en-PH",{dateStyle:"medium",timeZone:TZ});
const shortUtcDate=new Intl.DateTimeFormat("en-PH",{month:"short",day:"numeric",timeZone:"UTC"});

export const formatDateTime=(value:string|Date)=>phDateTime.format(new Date(value));
export const formatDate=(value:string|Date)=>phDate.format(new Date(value));
export const formatDateOnly=(value:string)=>shortUtcDate.format(new Date(`${value}T00:00:00Z`));
export const formatPhilippineDateTime=formatDateTime;
export function philippineDateKey(value:string|Date=new Date()){const parts=new Intl.DateTimeFormat("en-US",{year:"numeric",month:"2-digit",day:"2-digit",timeZone:TZ}).formatToParts(new Date(value));const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value||"";return `${get("year")}-${get("month")}-${get("day")}`}
