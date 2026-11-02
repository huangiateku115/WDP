import {useEffect} from 'react';
import {Controller,useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {View} from 'react-native';
import {periodSchema,dayLabel,endDay,type BookingDraft} from '../domain/booking';
import {AppText,Card,Filter,Input,ui} from './ui';
export function RentalPeriodSelector({draft,onChange}:{draft:Pick<BookingDraft,'start'|'months'>;onChange:(start:string,months:number)=>void}){
 const {control,formState:{errors},getValues,reset}=useForm<{start:string;months:number}>({resolver:zodResolver(periodSchema),mode:'onChange',defaultValues:{start:draft.start,months:draft.months}});
 useEffect(()=>{const current=getValues();if(current.start!==draft.start||current.months!==draft.months)reset({start:draft.start,months:draft.months});},[draft.start,draft.months,getValues,reset]);
 const parsed=periodSchema.safeParse({start:draft.start,months:draft.months});
 const dateError=parsed.success?undefined:parsed.error.issues.find(i=>i.path[0]==='start')?.message;
 return <Card><AppText variant="card">Kỳ thuê dự kiến</AppText><Controller control={control} name="start" render={({field})=><Input label="Ngày bắt đầu (YYYY-MM-DD)" value={field.value} placeholder="YYYY-MM-DD" autoCapitalize="none" maxLength={10} error={errors.start?.message||dateError} onBlur={field.onBlur} onChangeText={v=>{field.onChange(v);onChange(v,getValues('months'));}}/>}/><AppText variant="caption" style={ui.muted}>Ngày lịch Việt Nam; không chọn ngày đã qua. Kho trống chỉ được đối chiếu với fixture.</AppText><Controller control={control} name="months" render={({field})=><View style={ui.wrap}>{[1,3,6,12].map(m=><Filter key={m} label={m+' tháng'} selected={field.value===m} onPress={()=>{field.onChange(m);onChange(getValues('start'),m);}}/>)}</View>}/><AppText>Ngày kết thúc: {dayLabel(endDay(draft.start,draft.months)||'')}</AppText><AppText variant="caption" style={ui.muted}>Ngày kết thúc không bao gồm trong kỳ thuê; tính tháng lịch, giới hạn về ngày cuối tháng nếu cần. Đây là quy ước mẫu, chưa phải chính sách Backend.</AppText></Card>;
}
