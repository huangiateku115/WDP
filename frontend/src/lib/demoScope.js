// Full navigation restored at the user's request. Retain the helper contract for existing callers.
export const demoScopeEnabled=false;
const pages={
 manager:new Set(['customers','reservations','operations','tasks','facility-operations','work','extensions','maintenance','support','refunds','charges']),
 staff:new Set(['dashboard','customers','reservations','tasks','facility-operations','check-ins','handovers','inspections','checkouts','support','maintenance','refunds']),
};
const taskTypes=new Set(['CHECK_IN','HANDOVER','INSPECTION','CHECKOUT','SUPPORT','MAINTENANCE']);
export function isM4DemoPage(role,path){return !path||!demoScopeEnabled||!pages[role]||pages[role].has(path.split('/')[0]);}
export function isM4DemoMenu(role,path){return isM4DemoPage(role,path)&&(!demoScopeEnabled||role!=='manager'||path!=='facility-operations');}
export function isM4DemoTask(task){return !demoScopeEnabled||taskTypes.has(task.type);}
export function m4DemoHome(role){return role==='manager'&&demoScopeEnabled?'/manager/operations':`/${role}/dashboard`;}
