import {useRef, useState} from 'react';
import {useLocation} from 'react-router-dom';
import authApi from '@/api/authApi';
import {saveAuthSession, saveSessionUser, profileFromResponse, getAccessToken} from '@/lib/authSession';
import {apiErrorMessage} from '@/lib/apiError';
import referenceImages from '@/components/common/referenceImages';
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { LockKeyhole, Eye, ShieldCheck, AtSign } from "lucide-react";
export default function LoginPage() {
  const nav = useNavigate();
  const location=useLocation(),busy=useRef(false);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const signIn=async event=>{event.preventDefault();if(busy.current)return;busy.current=true;setPending(true);setError('');try{
    const response=await authApi.login({email:email.trim(),password});
    const tokens=response.data?.data;
    saveAuthSession({accessToken:tokens?.accessToken,refreshToken:tokens?.refreshToken,user:tokens?.user});
    let user=tokens?.user||null;
    try{user=profileFromResponse(await authApi.me());if(getAccessToken()!==tokens.accessToken)return;saveSessionUser(user);}catch(err){if(!getAccessToken())throw err;}
    nav(user?.role==='FACILITY_MANAGER'?'/manager/dashboard':user?.role==='FACILITY_STAFF'?'/staff/dashboard':user?.role==='BOM'?'/bom/dashboard':user?.role==='ADMIN'?'/admin/dashboard':'/portal');
  }catch(err){setError(apiErrorMessage(err,'Unable to sign in. Please try again.'));}finally{busy.current=false;setPending(false);}};
  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <Card className="grid overflow-hidden md:grid-cols-[1.2fr_.8fr]">
        <div className="p-8 md:p-10">
          <div className="flex items-center gap-3 text-sky-700">
            <LockKeyhole />
            <div>
              <b>SECURE ACCESS</b>
              <div className="text-sm text-slate-500">
                Client Management & Digital Access Portal
              </div>
            </div>
          </div>
          <h1 className="mt-6 text-3xl font-bold">
            Welcome back to SelfStorage
          </h1>
          <p className="mt-2 text-slate-600">
            Sign in to manage your active storage units, check gate PINs, and
            view contracts.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <Button variant="outline" disabled title="Provider API unavailable">Google</Button>
            <Button variant="outline" disabled title="Provider API unavailable">Apple</Button>
            <Button variant="outline" disabled title="Provider API unavailable">Zalo / OTP</Button>
          </div>
          <div className="my-6 text-center text-xs text-slate-500">
            OR SIGN IN WITH EMAIL
          </div>
          <form className="space-y-4" onSubmit={signIn}>
            <div>
              <div className="field-label">Email Address</div>
              <Input aria-label="Email address" type="email" autoComplete="username" placeholder="name@domain.com" required value={email} onChange={event=>setEmail(event.target.value)} disabled={pending} />
            </div>
            <div>
              <div className="flex justify-between">
                <span className="field-label">Password</span>
                <a className="text-xs text-blue-700">Forgot password?</a>
              </div>
              <div className="relative">
                <Input aria-label="Password" type="password" autoComplete="current-password" placeholder="••••••••••••" required value={password} onChange={event=>setPassword(event.target.value)} disabled={pending} />
                <Eye className="absolute right-4 top-3.5" size={18} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox defaultChecked disabled aria-label="Session stored on this device" />
              Stay signed in on this device until you sign out
            </div>
            {location.state?.registered&&<p role="status" className="text-sm text-emerald-700">Account created. Sign in with your new credentials.</p>}
            {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
            <Button className="w-full" size="lg" type="submit" disabled={pending}>
              {pending?'Signing in…':'Sign In to My Storage →'}
            </Button>
          </form>
          <p className="mt-5 text-center">
            New to SelfStorage?{" "}
            <Link className="font-bold text-blue-700" to="/register">
              Create an account →
            </Link>
          </p>
        </div>
        <div className="auth-showcase bg-blue-50 p-8">
          <div className="rounded-xl bg-white p-3 text-xs font-bold text-emerald-700">
            <span className="status-dot mr-2" />
            24/7 Gate Access Online
          </div>
          <div className="mt-6 aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-sky-100 to-blue-200 grid place-items-center">
            <img src={referenceImages.vaultspace_sign_in[0]} alt="Storage facility corridor" className="storage-photo" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          </div>
          <div className="mt-5 rounded-xl bg-[#0e4f2b] p-5 text-white"><div className="label text-blue-100">INSTANT DIGITAL KEY</div><div className="mt-2 text-lg font-bold">Your storage. Always within reach.</div><p className="mt-2 text-sm text-blue-100">Manage facility access and your rental from one secure portal.</p></div>
          <div className="mt-8 flex items-center gap-2 text-sm text-slate-600">
            <ShieldCheck size={17} /> 256-bit SSL Encrypted
          </div>
        </div>
      </Card>
    </div>
  );
}

