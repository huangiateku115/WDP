import {Redirect} from 'expo-router';
import {useLiveSession} from '../src/state/useLiveSession';
export default function Index(){return <Redirect href={useLiveSession(s=>s.user)?'/(tabs)':'/(auth)/login'}/>;}
