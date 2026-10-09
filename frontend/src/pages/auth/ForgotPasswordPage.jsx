import {useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import authApi from '@/api/authApi';
import {apiErrorMessage} from '@/lib/apiError';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
export default function ForgotPasswordPage(){
  const nav=useNavigate(),busy=useRef(false);
  const [email,setEmail]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  async function submit(event){event.preventDefault();if(busy.current)return;setError('');const address=email.trim();if(!address){setError('Email is required.');return;}busy.current=true;setPending(true);try{const response=await authApi.forgotPassword({email:address});if(response.data?.success!==true){setError(apiErrorMessage({response},'Unable to send OTP.'));return;}nav('/reset-password',{state:{email:address,otpSent:true}});}catch(err){setError(apiErrorMessage(err,'Unable to send OTP.'));}finally{busy.current=false;setPending(false);}}
  return <div className="mx-auto max-w-xl px-5 py-14"><Card className="p-8 md:p-10"><p className="label text-brand">SECURE ACCESS</p><h1 className="mt-4 text-3xl font-bold">Forgot your password?</h1><p className="mt-3 text-sm leading-6 text-slate-600">Enter your account email to receive a password reset OTP.</p><form onSubmit={submit} className="mt-6 space-y-5"><label className="block"><span className="field-label">Email Address</span><Input aria-label="Email address" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} disabled={pending}/></label>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<Button type="submit" className="w-full" disabled={pending}>{pending?'Sending OTP…':'Send OTP'}</Button></form><Link to="/login" className="mt-6 block text-center font-semibold text-brand">← Back to Sign In</Link></Card></div>;
}
