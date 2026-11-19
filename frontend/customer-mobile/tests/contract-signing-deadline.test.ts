import {contractDeadlineLabel,contractDeadlineState} from '../src/domain/contractSigning';

const now=Date.parse('2026-11-19T00:00:00.000Z');

test('contract deadline countdown uses an explicit timestamp and reports days and hours',()=>{
  expect(contractDeadlineState('2026-11-21T02:30:00.000Z',now)).toEqual({
    kind:'remaining',label:'Còn 2 ngày 2 giờ',deadlineAt:Date.parse('2026-11-21T02:30:00.000Z'),
  });
});

test('contract deadline reports a short window and expiry without inferring cancellation',()=>{
  expect(contractDeadlineState('2026-11-19T08:30:00+07:00',now)).toMatchObject({kind:'remaining',label:'Còn 1 giờ 30 phút'});
  expect(contractDeadlineState('2026-11-18T23:59:59.000Z',now)).toEqual({kind:'expired'});
});

test('missing or timezone-free contract deadlines are not guessed',()=>{
  expect(contractDeadlineState(undefined,now)).toEqual({kind:'missing'});
  expect(contractDeadlineState('2026-11-21T09:00:00',now)).toEqual({kind:'invalid'});
});

test('deadline display is localized to Ho Chi Minh time',()=>{
  expect(contractDeadlineLabel(Date.parse('2026-11-21T02:30:00.000Z'))).toContain('09:30');
});
