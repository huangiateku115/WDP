import {useLocalSearchParams} from 'expo-router';
import RentalRenewalScreen from '../../../src/screens/RentalRenewalScreen';
export default function RentalRenewalRoute(){const {id}=useLocalSearchParams<{id:string}>();return <RentalRenewalScreen id={id}/>;}
