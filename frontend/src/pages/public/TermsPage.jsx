import { useNavigate, useSearchParams } from 'react-router-dom';
import TermsModal from '@/components/customer/terms/TermsModal';

// Compatibility route: old /terms links open the shared modal, never a standalone Terms page.
export default function TermsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedService = params.get('serviceType');
  const serviceType = requestedService === 'MANAGED_INVENTORY' ? requestedService : 'SELF_STORAGE';
  const version = params.get('version') || null;
  const close = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/', { replace: true });
  };
  return <TermsModal open onClose={close} serviceType={serviceType} version={version} />;
}
