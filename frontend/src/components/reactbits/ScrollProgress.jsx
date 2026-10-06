import { useEffect, useState } from "react";
export default function ScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const f = () => {
      const h = document.documentElement.scrollHeight - innerHeight;
      setP(h ? (scrollY / h) * 100 : 0);
    };
    f();
    addEventListener("scroll", f, { passive: true });
    return () => removeEventListener("scroll", f);
  }, []);
  return (
    <div
      className="fixed left-0 top-0 z-[100] h-[3px] bg-[#F28C28] shadow-[0_0_12px_rgba(242,140,40,.55)]"
      style={{ width: `${p}%` }}
    />
  );
}
