import { Router } from 'express';
import * as controller from '../controllers/public/public-catalog.controller';

const router = Router();
router.get('/facilities', controller.listFacilities);
router.get('/facilities/:id/storage-options', controller.storageOptions);
router.get('/facilities/:id/pricing', controller.pricing);
router.get('/facilities/:id', controller.getFacility);
export default router;
