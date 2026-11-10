import {z} from 'zod';

export const accountUpdate=z.object({
  displayName:z.string().trim().min(1).max(120),
  phone:z.string().trim().regex(/^\+?[0-9][0-9 .()-]{6,19}$/).optional(),
}).strict();

export const profileUpdate=z.object({
  address:z.string().trim().max(300).refine(value=>!value||value.length>=2).optional(),
  taxCode:z.string().trim().max(32).optional(),
}).strict().refine(value=>value.address!==undefined||value.taxCode!==undefined);

export function optionalAddress(value?:string|null){
  const trimmed=value?.trim()??'';
  return trimmed.length>=2&&!trimmed.includes('\uFFFD')?trimmed:'';
}
