import {useLocalSearchParams} from 'expo-router';
import {ManagedSessionSkuPicker} from '../../../src/screens/ManagedSessionSkuPicker';
import {UnavailableScreen} from '../../../src/components/liveUI';

export default function ManagedInboundItemsRoute(){
  const {reservationId,sessionId}=useLocalSearchParams<{reservationId?:string;sessionId?:string|string[]}>();
  const activeSessionId=Array.isArray(sessionId)?sessionId[0]:sessionId;
  if(!reservationId||!activeSessionId)return <UnavailableScreen/>;
  return <ManagedSessionSkuPicker reservationId={reservationId} sessionId={activeSessionId}/>;
}
