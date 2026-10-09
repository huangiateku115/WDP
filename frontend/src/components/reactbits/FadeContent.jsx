import { useEffect, useRef, useState } from "react";

export default function FadeContent({
  children,
  className = "",
  delay = 0,
  duration = 700,
  blur = true,
  distance = 28,
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(node);
        }
      },
      { threshold: 0.14 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : `translateY(${distance}px)`,
        filter: visible || !blur ? "blur(0)" : "blur(8px)",
        transition: `opacity ${duration}ms ease ${delay}ms, transform ${duration}ms cubic-bezier(.2,.8,.2,1) ${delay}ms, filter ${duration}ms ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
