import {useRef, useState} from 'react';
import authApi from '@/api/authApi';
import {apiErrorMessage} from '@/lib/apiError';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, KeyRound, ClipboardCheck } from "lucide-react";
export default function RegisterPage() {
  const nav = useNavigate();
  const busy=useRef(false),[values,setValues]=useState({email:'',password:'',displayName:'',phone:''}),[accepted,setAccepted]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
  const change=(field,value)=>setValues(current=>({...current,[field]:value}));
  const register=async event=>{event.preventDefault();if(busy.current)return;setError('');if(!accepted){setError('Please accept the terms before creating your account.');return;}if(!values.displayName.trim()||!values.phone.trim()){setError('Name and phone are required.');return;}busy.current=true;setPending(true);try{await authApi.register({...values,email:values.email.trim(),displayName:values.displayName.trim(),phone:values.phone.trim()});nav('/login',{replace:true,state:{registered:true}});}catch(err){setError(apiErrorMessage(err,'Unable to create your account.'));}finally{busy.current=false;setPending(false);}};
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 lg:grid-cols-[.8fr_1.2fr]">
      <div className="blueprint-light rounded-2xl bg-blue-50 p-8">
        <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800">
          CREATE YOUR SelfStorage ACCOUNT
        </span>
        <h1 className="mt-6 text-4xl font-bold">
          Get instant access to secure self-storage
        </h1>
        <p className="mt-3 text-slate-600">
          Book your unit in under 3 minutes with zero paperwork and instant
          smartphone key access.
        </p>
        {[
          [ShieldCheck, "Instant online reservation & price lock"],
          [KeyRound, "Keyless 24/7 digital PIN & mobile entry"],
          [ClipboardCheck, "No deposit until contract signing"],
        ].map(([I, t]) => (
          <SpotlightCard key={t} className="mt-5"><Card className="p-5">
            <div className="flex gap-4">
              <I className="text-brand" />
              <div>
                <b>{t}</b>
                <p className="mt-1 text-sm text-slate-600">
                  Fast, secure and fully digital onboarding.
                </p>
              </div>
            </div>
          </Card></SpotlightCard>
        ))}
      </div>
      <Card className="p-8 md:p-10">
        <div className="flex justify-between">
          <div>
            <h2 className="text-3xl font-bold">Create your credentials</h2>
            <p className="mt-2 text-slate-600">
              Enter your details to activate your digital tenant dashboard.
            </p>
          </div>
          <span className="h-fit rounded bg-blue-50 px-2 py-1 text-xs">
            STEP 01/02
          </span>
        </div>
        <form className="mt-7 grid gap-5" onSubmit={register}>
          <div>
            <div className="field-label">Full Legal Name</div>
            <Input aria-label="Full legal name" autoComplete="name" placeholder="e.g. Nguyen Van An" required value={values.displayName} onChange={e=>change('displayName',e.target.value)} disabled={pending}/>
          </div>
          <div>
            <div className="field-label">Phone Number</div>
            <Input aria-label="Phone number" type="tel" autoComplete="tel" placeholder="+84 90 123 4567" required value={values.phone} onChange={e=>change('phone',e.target.value)} disabled={pending}/>
          </div>
          <div>
            <div className="field-label">Email Address</div>
            <Input aria-label="Email address" type="email" autoComplete="email" placeholder="name@example.com" required value={values.email} onChange={e=>change('email',e.target.value)} disabled={pending}/>
          </div>
          <div>
            <div className="field-label">Create Password</div>
            <Input aria-label="Create password" type="password" autoComplete="new-password" placeholder="Minimum 8 characters" minLength={8} required value={values.password} onChange={e=>change('password',e.target.value)} disabled={pending}/>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox aria-label="Accept terms and privacy policy" checked={accepted} onCheckedChange={value=>setAccepted(value===true)} disabled={pending}/>I agree to the SelfStorage Terms of Service and Privacy
            Policy.
          </label>
          {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button size="lg" type="submit" disabled={pending||!accepted}>
            {pending?'Creating account…':'Create Account & Get Started →'}
          </Button>
          <p className="text-center text-sm">
            Already have an account?{" "}
            <Link to="/login" className="text-blue-700">
              Sign in
            </Link>
          </p>
        </form>
      </Card>
    </div>
  );
}


