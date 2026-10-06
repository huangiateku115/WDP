import { useEffect, useRef, useState } from "react";
export default function CountUp({
  to = 100,
  duration = 1200,
  suffix = "",
  prefix = "",
}) {
  const ref = useRef(null);
  const [value, setValue] = useState(0);
  const [run, setRun] = useState(false);
  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    const o = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setRun(true);
          o.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    o.observe(n);
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (!run) return;
    let id;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min((t - start) / duration, 1);
      setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [run, to, duration]);
  return (
    <span ref={ref}>
      {prefix}
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}
