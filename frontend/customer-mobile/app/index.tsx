import {Redirect} from 'expo-router';
import {useCustomerStore} from '../src/state/useCustomerStore';
export default function Index(){return <Redirect href={useCustomerStore(s=>s.demoSession)?'/(tabs)':'/(auth)/login'}/>;}
