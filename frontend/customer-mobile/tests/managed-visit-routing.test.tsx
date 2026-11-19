import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import {fireEvent,render,screen} from '@testing-library/react-native';
import {ManagedVisitActivityScreen} from '../src/screens/ManagedVisitActivityScreen';
import VisitsIndexRoute from '../app/managed/reservations/[reservationId]/visits/index';

const mockPush=jest.fn(),mockReplace=jest.fn(),mockBack=jest.fn(),mockReservationId='3'.repeat(24),mockOwner='1'.repeat(24),mockFacilityId='2'.repeat(24);
const mockRental={_id:mockReservationId,customerId:mockOwner,facilityId:mockFacilityId,reservationCode:'MIR-ROUTE',serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:'2025-01-01T00:00:00.000Z',endDate:'2099-12-31T00:00:00.000Z'};

jest.mock('expo-router',()=>({useLocalSearchParams:()=>({reservationId:mockReservationId}),useRouter:()=>({push:mockPush,replace:mockReplace,back:mockBack})}));
jest.mock('../src/state/useLiveSession',()=>({useLiveSession:(selector:(state:{user:{_id:string}})=>unknown)=>selector({user:{_id:mockOwner}})}));
jest.mock('../src/components/liveUI',()=>({useScreenActive:()=>true,useResource:(key:string)=>({
  data:key.includes('activity-visits:')||key.includes('activity-sessions:')?[]:mockRental,
  loading:false,error:undefined,httpStatus:undefined,reload:jest.fn(),
}),ResourceState:()=>null}));

it('the official visits index route renders the activity screen',()=>{
  expect(VisitsIndexRoute).toBe(ManagedVisitActivityScreen);
});

it('route files contain no duplicate canonical patterns (including file vs index collisions)',()=>{
  const appRoot=path.resolve(__dirname,'../app');
  const routeFiles:string[]=[];
  const walk=(directory:string)=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const target=path.join(directory,entry.name);
      if(entry.isDirectory())walk(target);
      else if(/\.(tsx|ts|jsx|js)$/.test(entry.name)&&!entry.name.startsWith('_')&&!entry.name.startsWith('+'))routeFiles.push(target);
    }
  };
  walk(appRoot);
  const patternOwners=new Map<string,string[]>();
  for(const file of routeFiles){
    const relative=path.relative(appRoot,file).replace(/\\/g,'/').replace(/\.(tsx|ts|jsx|js)$/,'');
    const segments=relative.split('/');
    if(segments.at(-1)==='index')segments.pop();
    const pattern='/'+segments
      .map(part=>part.startsWith('[...')?':*':part.startsWith('[')?':'+part.slice(1,-1):part).filter(Boolean).join('/');
    patternOwners.set(pattern,[...(patternOwners.get(pattern)??[]),relative]);
  }
  const collisions=[...patternOwners].filter(([,owners])=>owners.length>1);
  expect(collisions).toEqual([]);
});

it('renders both tabs and navigates to scoped Visit and Reservation detail routes',async()=>{
  await render(<ManagedVisitActivityScreen/>);
  expect(screen.getByText('Chưa có lịch đến kho')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'Phiên truy cập'}));
  expect(screen.getByText('Chưa có phiên truy cập đang hoạt động')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'Đặt lịch đến kho'}));
  expect(mockPush).toHaveBeenCalledWith({pathname:'/managed/reservations/[reservationId]/visits/new',params:{reservationId:mockRental._id}});
  await fireEvent.press(screen.getByRole('button',{name:'Quay lại'}));
  expect(mockReplace).toHaveBeenCalledWith({pathname:'/managed/[facilityId]/confirmation',params:{facilityId:mockFacilityId,reservationId:mockReservationId}});
  expect(mockBack).not.toHaveBeenCalled();
});
