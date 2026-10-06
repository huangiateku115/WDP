import FadeContent from '@/components/reactbits/FadeContent';
import { useLocation } from 'react-router-dom';
export default function ExperienceContent({ children }) {
  const { pathname } = useLocation();
  return <FadeContent key={pathname} className="experience-motion" blur={false} distance={10} duration={350}>{children}</FadeContent>;
}
