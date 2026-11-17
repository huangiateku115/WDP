import React,{useState} from 'react';
import {fireEvent,render} from '@testing-library/react-native';
import {AppText} from '../src/components/ui';
import {TermsModal,TermsReviewCard} from '../src/components/TermsReview';

function TermsHarness({onAccept=jest.fn()}:{onAccept?:()=>void}){
  const [visible,setVisible]=useState(false);
  return <>
    <TermsReviewCard title="Điều khoản kho" version="v1" accepted={false} onOpen={()=>setVisible(true)}/>
    <TermsModal visible={visible} title="Điều khoản kho" version="v1" onClose={()=>setVisible(false)} onAccept={()=>{onAccept();setVisible(false);}}>
      <AppText>Điều khoản do API cung cấp</AppText>
      <AppText>{'Nội dung dài. '.repeat(120)}</AppText>
    </TermsModal>
  </>;
}

test('terms stay in a modal, content is scrollable, and fixed-footer acceptance does not require scrolling',async()=>{
  const onAccept=jest.fn();
  const view=await render(<TermsHarness onAccept={onAccept}/>);
  expect(view.queryByTestId('terms-modal')).toBeNull();
  await fireEvent.press(view.getByRole('button',{name:'Xem điều khoản'}));
  expect(view.getByTestId('terms-modal-scroll')).toBeTruthy();
  expect(view.getByText('Điều khoản do API cung cấp')).toBeTruthy();
  await fireEvent.press(view.getByRole('button',{name:'Đồng ý điều khoản'}));
  expect(onAccept).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId('terms-modal')).toBeNull();
});

test('closing terms modal does not accept them',async()=>{
  const onAccept=jest.fn();
  const view=await render(<TermsHarness onAccept={onAccept}/>);
  await fireEvent.press(view.getByRole('button',{name:'Xem điều khoản'}));
  await fireEvent.press(view.getByRole('button',{name:'Đóng điều khoản'}));
  expect(onAccept).not.toHaveBeenCalled();
  expect(view.queryByTestId('terms-modal')).toBeNull();
});
