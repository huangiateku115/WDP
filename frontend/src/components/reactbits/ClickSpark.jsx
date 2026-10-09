import { useEffect, useState } from "react";
export default function ClickSpark() {
  const [sparks, setSparks] = useState([]);
  useEffect(() => {
    const click = (e) => {
      const id = Date.now() + Math.random();
      setSparks((s) => [...s, { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => setSparks((s) => s.filter((v) => v.id !== id)), 650);
    };
    window.addEventListener("click", click);
    return () => window.removeEventListener("click", click);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {sparks.map((s) => (
        <span
          key={s.id}
          className="rb-click-spark"
          style={{ left: s.x, top: s.y }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <i key={i} style={{ "--r": `${i * 45}deg` }} />
          ))}
        </span>
      ))}
    </div>
  );
}
