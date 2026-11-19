import React from 'react';
import {AppState,Pressable,Text,View,type AppStateStatus} from 'react-native';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {useResource} from '../src/components/liveUI';
import {claimRequestOnce} from '../src/domain/requestLifecycle';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

jest.mock('expo-router',()=>({useFocusEffect:(effect:()=>void|(()=>void))=>require('react').useEffect(effect,[effect])}));

function Probe({resourceKey,load}:{resourceKey:string;load:(signal:AbortSignal)=>Promise<string>}){
  const resource=useResource(resourceKey,load);
  return <View><Text testID="value">{resource.data??'—'}</Text><Text testID="loading">{String(resource.loading)}</Text>
    <Text testID="refreshing">{String(resource.refreshing)}</Text><Text testID="error">{resource.error??''}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="refresh" onPress={resource.reload}><Text>Refresh</Text></Pressable></View>;
}

function deferred<T>(){
  let resolve!:(value:T)=>void;let reject!:(reason?:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

let listeners:Set<(state:AppStateStatus)=>void>;
let removeListener:jest.Mock;
beforeEach(()=>{
  listeners=new Set();removeListener=jest.fn();
  jest.spyOn(AppState,'addEventListener').mockImplementation((_type,listener)=>{
    listeners.add(listener);return {remove:()=>{listeners.delete(listener);removeListener();}} as any;
  });
});
afterEach(()=>jest.restoreAllMocks());

test('mount fetches once and ordinary re-render does not issue another request',async()=>{
  const initial=deferred<string>(),load=jest.fn(()=>initial.promise);
  const view=await render(<Probe resourceKey="customer-a:reservation-1" load={load}/>);
  await act(async()=>initial.resolve('stable'));
  await waitFor(()=>expect(screen.getByTestId('value').props.children).toBe('stable'));
  await view.rerender(<Probe resourceKey="customer-a:reservation-1" load={load}/>);
  expect(load).toHaveBeenCalledTimes(1);
});

test('manual refresh retains the last good result and marks only a background refresh',async()=>{
  const initial=deferred<string>(),next=deferred<string>();
  const load=jest.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(next.promise);
  await render(<Probe resourceKey="customer-a:reservation-1" load={load}/>);
  await act(async()=>initial.resolve('confirmed'));
  await waitFor(()=>expect(screen.getByTestId('value').props.children).toBe('confirmed'));
  await fireEvent.press(screen.getByRole('button',{name:'refresh'}));
  await waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('value').props.children).toBe('confirmed');
  expect(screen.getByTestId('loading').props.children).toBe('false');
  expect(screen.getByTestId('refreshing').props.children).toBe('true');
  await act(async()=>next.resolve('updated'));
  await waitFor(()=>expect(screen.getByTestId('value').props.children).toBe('updated'));
});

test('foreground refresh runs once per background-to-active transition and failures do not auto-retry',async()=>{
  const first=deferred<string>(),second=deferred<string>(),requests=[first,second];
  let call=0;const load=jest.fn(()=>requests[call++]!.promise);
  await render(<Probe resourceKey="customer-a:reservation-1" load={load}/>);
  await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));
  await act(async()=>first.reject(Object.assign(new Error('Conflict'),{response:{status:409,data:{code:'RESERVATION_NOT_VISIT_READY'}}})));
  await waitFor(()=>expect(screen.getByTestId('error').props.children).toBeTruthy());
  await act(async()=>{for(const listener of listeners)listener('background');for(const listener of listeners)listener('active');});
  await waitFor(()=>expect(load).toHaveBeenCalledTimes(2));
  await act(async()=>second.reject(Object.assign(new Error('Conflict'),{response:{status:409,data:{code:'RESERVATION_NOT_VISIT_READY'}}})));
  await act(async()=>{for(const listener of listeners)listener('active');});
  expect(load).toHaveBeenCalledTimes(2);
});

test('changing Customer/resource identity ignores the previous response and does not reuse its data',async()=>{
  const old=deferred<string>(),fresh=deferred<string>();
  const loadOld=jest.fn(()=>old.promise),loadFresh=jest.fn(()=>fresh.promise);
  const view=await render(<Probe resourceKey="customer-a:reservation-1" load={loadOld}/>);
  await view.rerender(<Probe resourceKey="customer-b:reservation-1" load={loadFresh}/>);
  await act(async()=>fresh.resolve('customer-b'));
  await waitFor(()=>expect(screen.getByTestId('value').props.children).toBe('customer-b'));
  await act(async()=>old.resolve('customer-a'));
  expect(screen.getByTestId('value').props.children).toBe('customer-b');
});

test('unmount aborts the pending request and removes the AppState listener',async()=>{
  const pending=deferred<string>();let signal:AbortSignal|undefined;
  const load=jest.fn((next:AbortSignal)=>{signal=next;return pending.promise;});
  const view=await render(<Probe resourceKey="customer-a:reservation-1" load={load}/>);
  await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));
  await view.unmount();
  expect(signal?.aborted).toBe(true);
  expect(listeners.size).toBe(0);
  expect(removeListener).toHaveBeenCalledTimes(1);
});

test('an applied payment triggers at most one Reservation refresh across remounts',()=>{
  const seen=new Set<string>(),identity='customer-a:reservation-1:payment-1';
  expect(claimRequestOnce(seen,identity)).toBe(true);
  expect(claimRequestOnce(seen,identity)).toBe(false);
  expect(claimRequestOnce(seen,'customer-a:reservation-1:payment-2')).toBe(true);
  expect(claimRequestOnce(seen,'')).toBe(false);
});
