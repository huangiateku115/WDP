import { Router } from 'express';
import * as ContractController from '../controllers/contracts/contract.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';

const router = Router();

router.use(requireAuth);

router.get('/me', ContractController.getMyContracts);
router.get('/:id', ContractController.getContractById);
router.patch('/:id/sign', ContractController.signContract);

export default router;
