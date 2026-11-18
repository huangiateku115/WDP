export type VisitSuccessFeedback={reservationId:string;visitId:string};

let feedback:VisitSuccessFeedback|null=null;
const listeners=new Set<()=>void>();
function emit(){for(const listener of listeners)listener();}

export function publishVisitSuccessFeedback(value:VisitSuccessFeedback){feedback=value;emit();}
export function dismissVisitSuccessFeedback(reservationId:string){if(feedback?.reservationId===reservationId){feedback=null;emit();}}
export function subscribeVisitSuccessFeedback(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
export function getVisitSuccessFeedback(){return feedback;}
