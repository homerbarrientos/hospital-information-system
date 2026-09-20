const PH_OFFSET_MS=8*60*60*1000;
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const pad=(value:number)=>String(value).padStart(2,"0");
const philippineParts=(value:string|Date)=>{const date=new Date(new Date(value).getTime()+PH_OFFSET_MS);return{year:date.getUTCFullYear(),month:date.getUTCMonth(),day:date.getUTCDate(),hour:date.getUTCHours(),minute:date.getUTCMinutes()}};

export const formatDateTime=(value:string|Date)=>{const part=philippineParts(value),hour=part.hour%12||12;return `${MONTHS[part.month]} ${part.day}, ${part.year}, ${hour}:${pad(part.minute)} ${part.hour<12?"AM":"PM"}`};
export const formatDate=(value:string|Date)=>{const part=philippineParts(value);return `${MONTHS[part.month]} ${part.day}, ${part.year}`};
export const formatDateOnly=(value:string)=>{const [,month,day]=value.split("-").map(Number);return `${MONTHS[month-1]} ${day}`};
export const formatPhilippineDateTime=formatDateTime;
export function philippineDateKey(value:string|Date=new Date()){const part=philippineParts(value);return `${part.year}-${pad(part.month+1)}-${pad(part.day)}`}
