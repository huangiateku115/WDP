import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, UserCircle } from "lucide-react";
import LogoutButton from "@/components/common/LogoutButton";
import { Button } from "@/components/ui/button";
export default function CustomerUserMenu({ user }) {
  const [open, setOpen] = useState(false),
    root = useRef(null),
    trigger = useRef(null),
    location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    root.current.querySelector("[data-user-panel] a")?.focus();
    const dismiss = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
          setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
        if (open && ["ArrowDown", "ArrowUp"].includes(e.key)) {
          e.preventDefault();
          const items = [
              ...root.current.querySelectorAll(
                "[data-user-panel] a,[data-user-panel] button:not(:disabled)",
              ),
            ],
            index = items.indexOf(document.activeElement);
          items[
            (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
          ]?.focus();
        }
      }}
    >
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        aria-label="Tài khoản khách hàng"
        aria-expanded={open}
        aria-controls="customer-user-panel"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="gap-2 px-2"
      >
        <UserCircle size={22} />
        <span className="portal-user min-w-0 max-w-40 truncate text-left text-xs">
          <b>{user?.displayName || "Customer"}</b>
          <span className="block text-slate-600">Client account</span>
        </span>
        <ChevronDown size={14} />
      </Button>
      {open && (
        <div
          id="customer-user-panel"
          data-user-panel
          className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-[#dce7de] bg-white p-3 shadow-xl"
          aria-label="Tùy chọn tài khoản khách hàng"
        >
          <Link
            to="/portal/profile"
            onClick={() => setOpen(false)}
            className="mb-3 block rounded-lg px-3 py-2 text-sm font-semibold text-[#176B3A] hover:bg-[#EAF5EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F28C28]"
          >
            Hồ sơ cá nhân
          </Link>
          <LogoutButton />
        </div>
      )}
    </div>
  );
}
