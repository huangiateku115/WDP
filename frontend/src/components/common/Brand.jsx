import { Warehouse } from "lucide-react";
export default function Brand({ light = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#176B3A] text-white shadow-sm">
        <Warehouse size={20} strokeWidth={2.2} />
      </span>
      <div className="leading-none">
        <div className={`font-heading text-xl font-extrabold tracking-[-.04em] ${light ? "text-white" : "text-[#173D28]"}`}>
          Vault<span className="text-[#F28C28]">Space</span>
        </div>
        <div className={`mt-1 text-[8px] font-bold uppercase tracking-[.18em] ${light ? "text-white/65" : "text-[#6D776F]"}`}>
          Self Storage Vietnam
        </div>
      </div>
    </div>
  );
}
