import ExperienceContent from '@/components/common/ExperienceContent';
import './experience.css';
import { Outlet, Link } from "react-router-dom";
import Brand from "@/components/common/Brand";
export default function AuthLayout() {
  return (
    <div className="experience-theme auth-shell min-h-screen bg-[#f9f7ff]">
      <header className="flex h-16 items-center justify-between border-b bg-white px-8">
        <Link to="/">
          <Brand />
        </Link>
        <Link to="/" className="text-sm">
          ← Return to site
        </Link>
      </header>
      <ExperienceContent><Outlet /></ExperienceContent>
      <div className="py-5 text-center text-xs text-slate-500">
        © 2026 SelfStorage Self-Storage Vietnam. Secured 256-bit SSL Connection.
      </div>
    </div>
  );
}

