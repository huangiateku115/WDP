export default function ShinyText({ children, className = "" }) {
  return <span className={`rb-shiny ${className}`}>{children}</span>;
}
