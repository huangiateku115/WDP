import { Router } from 'express';
import * as ContractController from '../controllers/contracts/contract.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';
import * as ManagedCheckinController from '../controllers/reservations/managed-checkin.controller';
import { uploadProofMiddleware } from '../middlewares/upload.middleware';

const router = Router();

router.use(requireAuth);

router.get('/me', requireRole([UserRole.CUSTOMER]), ContractController.getMyContracts);
router.get('/reservation/:reservationId', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ContractController.getContractByReservationId);
router.get('/:id/print', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ContractController.getContractPrintData);
router.get('/:id', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ContractController.getContractById);
router.patch('/:id/sign', requireRole([UserRole.CUSTOMER]), ContractController.signContract);
router.patch('/:id/sign/facility', requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]), ManagedCheckinController.signFacilityContract);

// Staff xác nhận đã ký hợp đồng giấy và upload ảnh chụp bằng chứng lên Cloudinary
router.post(
  '/:id/confirm-signed-paper',
  requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN]),
  uploadProofMiddleware.single('proofFile'),
  ContractController.confirmSignedPaper
);

export default router;

