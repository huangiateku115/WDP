import { RequestHandler } from 'express';
import { getCurrentTerms, getTermsVersion, listTermsVersions, TermsService } from '../../services/terms/terms.catalog';

const serviceType = (value: unknown): TermsService | null =>
  value === 'SELF_STORAGE' || value === 'MANAGED_INVENTORY' ? value : null;

export const list: RequestHandler = (req, res) => {
  const service = serviceType(req.query.serviceType);
  if (!service) return res.status(422).json({ success: false, code: 'INVALID_SERVICE_TYPE', message: 'serviceType must be SELF_STORAGE or MANAGED_INVENTORY' });
  const versions = listTermsVersions(service);
  return res.json({ success: true, data: { serviceType: service, current: getCurrentTerms(service) ?? null, latest: versions[0] ?? null, versions: versions.map(({ version, versionId, status, legalReviewStatus, effectiveFrom, documentCode }) => ({ version, versionId, status, legalReviewStatus, effectiveFrom, documentCode })) } });
};

export const current: RequestHandler = (req, res) => {
  const service = serviceType(req.query.serviceType);
  if (!service) return res.status(422).json({ success: false, code: 'INVALID_SERVICE_TYPE', message: 'serviceType must be SELF_STORAGE or MANAGED_INVENTORY' });
  const terms = getCurrentTerms(service);
  if (!terms) return res.status(404).json({ success: false, code: 'NO_EFFECTIVE_TERMS', message: 'No legally effective terms are configured for this service.' });
  return res.json({ success: true, data: terms });
};

export const version: RequestHandler = (req, res) => {
  const service = serviceType(req.query.serviceType);
  if (!service) return res.status(422).json({ success: false, code: 'INVALID_SERVICE_TYPE', message: 'serviceType must be SELF_STORAGE or MANAGED_INVENTORY' });
  const versionId = req.params.version;
  if (typeof versionId !== 'string') return res.status(404).json({ success: false, code: 'TERMS_VERSION_NOT_FOUND', message: 'Terms version not found for this service.' });
  const terms = getTermsVersion(service, versionId);
  if (!terms) return res.status(404).json({ success: false, code: 'TERMS_VERSION_NOT_FOUND', message: 'Terms version not found for this service.' });
  return res.json({ success: true, data: terms });
};
