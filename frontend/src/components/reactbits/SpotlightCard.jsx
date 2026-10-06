import { useRef } from "react";
export default function SpotlightCard({ children, className = "" }) {
  const ref = useRef(null);
  const move = (e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div ref={ref} onMouseMove={move} className={`rb-spotlight ${className}`}>
      {children}
    </div>
  );
}
