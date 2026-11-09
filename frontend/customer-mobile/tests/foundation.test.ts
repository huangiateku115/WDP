import {loginSchema,registrationSchema} from '../src/forms/auth';
import {apiClient} from '../src/api/client';
import {useCustomerStore} from '../src/state/useCustomerStore';
import {customerFixtures} from '../src/fixtures/customer';
import {verifiedFixtureStock} from '../src/domain/models';

afterEach(()=>useCustomerStore.setState({demoSession:false,fixtures:customerFixtures,compactCards:false}));
test('login validates fixture fields without claiming authentication',()=>{
  expect(loginSchema.safeParse({email:'bad',password:'123'}).success).toBe(false);
  expect(loginSchema.safeParse({email:'demo@vaultspace.vn',password:'VaultDemo123!'}).success).toBe(true);
});
test('registration validates confirmation, consent and phone without an API',()=>{
  const sample={name:'Khách Mẫu',email:'demo@vaultspace.vn',phone:'0900000123',password:'VaultDemo123!',confirmation:'VaultDemo123!',consent:true};
  expect(registrationSchema.safeParse(sample).success).toBe(true);
  expect(registrationSchema.safeParse({...sample,confirmation:'different'}).success).toBe(false);
  expect(registrationSchema.safeParse({...sample,consent:false}).success).toBe(false);
});
test('fixture session is local and logout clears it',()=>{
  useCustomerStore.getState().enterDemo();expect(useCustomerStore.getState().demoSession).toBe(true);
  useCustomerStore.getState().toggleCompactCards();expect(useCustomerStore.getState().compactCards).toBe(true);
  useCustomerStore.getState().leaveDemo();expect(useCustomerStore.getState().demoSession).toBe(false);
  expect(useCustomerStore.getState().compactCards).toBe(false);
});
test('unknown or inconsistent stock never becomes positive availability',()=>{
  expect(verifiedFixtureStock(null)).toBeNull();
  expect(verifiedFixtureStock({onHand:5,held:2,available:99})).toBeNull();
  expect(verifiedFixtureStock({onHand:5,held:2,available:3})).toEqual({onHand:5,held:2,available:3});
});
test.each(['get','post','put','patch','delete'] as const)('%s cannot reach a transport even with an injected adapter',async method=>{
  const adapter=jest.fn();
  await expect(apiClient.request({url:'https://must-not-connect.invalid',method,adapter})).rejects.toMatchObject({code:'API_ORIGIN_REJECTED'});
  expect(adapter).not.toHaveBeenCalled();
});
