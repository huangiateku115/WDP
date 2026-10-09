import { useRef } from "react";
export default function Magnet({ children, className = "", strength = 14 }) {
  const ref = useRef(null);
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = ((e.clientX - r.left - r.width / 2) / r.width) * strength;
    const y = ((e.clientY - r.top - r.height / 2) / r.height) * strength;
    ref.current.style.transform = `translate(${x}px,${y}px)`;
  };
  const leave = () => (ref.current.style.transform = "translate(0,0)");
  return (
    <div
      ref={ref}
      onMouseMove={move}
      onMouseLeave={leave}
      className={`rb-magnet ${className}`}
    >
      {children}
    </div>
  );
}
