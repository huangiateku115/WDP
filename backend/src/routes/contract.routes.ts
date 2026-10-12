import { Router } from 'express';
import * as ContractController from '../controllers/contracts/contract.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();

router.use(requireAuth);

router.get('/me', requireRole([UserRole.CUSTOMER]), ContractController.getMyContracts);
router.get('/:id', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ContractController.getContractById);
router.patch('/:id/sign', requireRole([UserRole.CUSTOMER]), ContractController.signContract);

export default router;
