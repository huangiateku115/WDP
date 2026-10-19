import {useEffect, useRef, useState} from 'react';
import {useLocation} from 'react-router-dom';
import authApi from '@/api/authApi';
import {saveAuthSession, saveSessionUser, profileFromResponse, getAccessToken,clearAuthSession,useAuthSession,consumeLogoutWarning} from '@/lib/authSession';
import {authenticatedDestination} from '@/lib/customerRedirect';
import {apiErrorMessage} from '@/lib/apiError';
import referenceImages from '@/components/common/referenceImages';
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { LockKeyhole, Eye, EyeOff, ShieldCheck, AtSign } from "lucide-react";
export default function LoginPage() {
  const nav = useNavigate();
  const location=useLocation(),busy=useRef(false);
  const [showPassword,setShowPassword]=useState(false);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const session=useAuthSession(),[remember,setRemember]=useState(false),[returning,setReturning]=useState(null),[checking,setChecking]=useState(false);
  const [logoutWarning]=useState(()=>consumeLogoutWarning());
  useEffect(()=>{consumeLogoutWarning(true);},[]);
  const mounted=useRef(false),validation=useRef(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;validation.current?.abort();};},[]);
  useEffect(()=>{
    setReturning(null);
    if(!session.remembered||!session.accessToken||busy.current){setChecking(false);return;}
    const controller=new AbortController(),token=session.accessToken;validation.current=controller;setChecking(true);
    authApi.me({signal:controller.signal}).then(response=>{
      if(controller.signal.aborted||getAccessToken()!==token)return;
      const user=profileFromResponse(response);authenticatedDestination(user.role);saveSessionUser(user);setReturning({token,user});
    }).catch(()=>{
      if(controller.signal.aborted)return;
      if(getAccessToken()===token)clearAuthSession();
      setError('We could not validate your saved session. Please sign in with your password.');
    }).finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return()=>controller.abort();
  },[session.accessToken,session.remembered]);
  function anotherAccount(){validation.current?.abort();clearAuthSession();setReturning(null);setChecking(false);setEmail('');setPassword('');setRemember(false);setError('');}
  async function continueSession(){
    if(busy.current||!returning||getAccessToken()!==returning.token)return;
    busy.current=true;setPending(true);setError('');const token=returning.token,controller=new AbortController();validation.current=controller;
    try{
      const user=profileFromResponse(await authApi.me({signal:controller.signal}));
      if(!mounted.current||getAccessToken()!==token)return;
      const destination=authenticatedDestination(user.role,location.state?.from);saveSessionUser(user);nav(destination,{replace:true});
    }catch(err){
      if(!mounted.current||controller.signal.aborted)return;
      if(getAccessToken()===token)clearAuthSession();setReturning(null);setError('Your saved session is unavailable or expired. Please sign in with your password.');
    }finally{busy.current=false;if(mounted.current)setPending(false);}
  }
  const signIn=async event=>{event.preventDefault();if(busy.current)return;busy.current=true;setPending(true);setError('');try{
    clearAuthSession();setReturning(null);
    const response=await authApi.login({email:email.trim(),password});
    const tokens=response.data?.data;
    if(!mounted.current)return;
    saveAuthSession({accessToken:tokens?.accessToken,refreshToken:tokens?.refreshToken,user:tokens?.user,remember:false});
    try{
      const user=profileFromResponse(await authApi.me());if(!mounted.current||getAccessToken()!==tokens.accessToken)return;
      const destination=authenticatedDestination(user.role,location.state?.from);
      saveAuthSession({accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,user,remember});setPassword('');nav(destination,{replace:true});
    }catch(err){if(getAccessToken()===tokens.accessToken)clearAuthSession();throw err;}
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
          {checking&&<p role="status" className="mt-6 text-sm text-slate-600">Checking your saved session…</p>}
          {returning&&session.accessToken===returning.token?<div className="mt-6 space-y-4 rounded-xl border border-green-200 bg-green-50 p-5">
            <p className="font-semibold text-[#176B3A]">Welcome back!</p><p className="break-words text-xl font-bold">{returning.user.displayName||returning.user.email||'Your account'}</p><p className="text-sm text-slate-600">{returning.user.role}</p>
            <Button className="w-full" disabled={pending} onClick={continueSession}>{pending?'Validating session…':`Continue as ${returning.user.displayName||returning.user.email||'your account'}`}</Button>
            <Button variant="outline" className="w-full" disabled={pending} onClick={anotherAccount}>Sign in with another account</Button>
          </div>:!checking&&<form className="mt-6 space-y-4" onSubmit={signIn}>
            <div>
              <div className="field-label">Email Address</div>
              <Input aria-label="Email address" type="email" autoComplete="username" placeholder="name@domain.com" required value={email} onChange={event=>setEmail(event.target.value)} disabled={pending} />
            </div>
            <div>
              <div className="flex justify-between">
                <span className="field-label">Password</span>
                <Link to="/forgot-password" className="text-xs text-blue-700">Forgot password?</Link>
              </div>
              <div className="relative">
                <Input aria-label="Password" type={showPassword?'text':'password'} className="pr-12" autoComplete="current-password" placeholder="••••••••••••" required value={password} onChange={event=>setPassword(event.target.value)} disabled={pending} />
                <button type="button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#176B3A]">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button>
              </div>
            </div>
            <label htmlFor="remember-login" className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox id="remember-login" checked={remember} disabled={pending} onCheckedChange={value=>setRemember(value===true)} />
              Remember Me
            </label>
            {location.state?.passwordReset?<p role="status" className="text-sm text-emerald-700">Password reset successfully. Sign in with your new password.</p>:location.state?.registered&&<p role="status" className="text-sm text-emerald-700">Account created. Sign in with your new credentials.</p>}
            {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
            <Button className="w-full" size="lg" type="submit" disabled={pending}>
              {pending?'Signing in…':'Sign In to My Storage →'}
            </Button>
          </form>}
          {checking&&<Button variant="outline" className="mt-4" onClick={anotherAccount}>Sign in with another account</Button>}
          {(logoutWarning||location.state?.logoutWarning)&&<p role="status" className="mt-4 text-sm text-orange-800">Signed out on this device. The server could not confirm session revocation.</p>}
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

