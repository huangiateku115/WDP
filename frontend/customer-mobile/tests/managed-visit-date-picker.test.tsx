import React from 'react';
import {fireEvent,render,screen} from '@testing-library/react-native';
import {Platform} from 'react-native';
import {ManagedVisitDatePicker} from '../src/components/ManagedVisitDatePicker';

jest.mock('@expo/ui/community/datetime-picker',()=>()=>null);

const hcmDate=(date:Date)=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(value=>value.type===type)?.value??'';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

it('opens the Web calendar and returns a selected HCMC date',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(Platform,'OS');
  Object.defineProperty(Platform,'OS',{configurable:true,value:'web'});
  const onChange=jest.fn(),today=hcmDate(new Date());
  const [year,month,day]=today.split('-').map(Number),nextDate=new Date(Date.UTC(year!,month!-1,day!+1,5));
  const next=hcmDate(nextDate);
  try{
    await render(<ManagedVisitDatePicker value={today} onChange={onChange}/>);
    await fireEvent.press(screen.getByRole('button',{name:'Chọn ngày đến kho'}));
    expect(screen.getByText(new Intl.DateTimeFormat('vi-VN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${today.slice(0,7)}-01T12:00:00Z`)))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button',{name:`Chọn ngày ${next}`}));
    expect(onChange).toHaveBeenCalledWith(next);
  }finally{
    if(descriptor)Object.defineProperty(Platform,'OS',descriptor);
  }
});
