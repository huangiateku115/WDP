import { Router } from 'express';
import * as controller from '../controllers/warehouse-map/warehouse-map.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();
const managers = [UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER];
const readers = [...managers, UserRole.FACILITY_STAFF];

// Customer access is limited to allowlisted, reservation-scoped map read models.
router.get('/warehouse-map', requireAuth, controller.warehouseMap);
router.get('/racks/:id/detail-map', requireAuth, controller.rackDetailMap);

router.post('/warehouse-zones', requireAuth, requireRole(managers), controller.createZone);
router.get('/warehouse-zones', requireAuth, requireRole(readers), controller.listZones);
router.get('/warehouse-zones/:id', requireAuth, requireRole(readers), controller.getZone);
router.patch('/warehouse-zones/:id', requireAuth, requireRole(managers), controller.updateZone);
router.delete('/warehouse-zones/:id', requireAuth, requireRole(managers), controller.deleteZone);
router.post('/warehouse-zones/:id/restore', requireAuth, requireRole(managers), controller.restoreZone);

router.post('/racks', requireAuth, requireRole(managers), controller.createRack);
router.get('/racks', requireAuth, requireRole(readers), controller.listRacks);
router.get('/racks/:id', requireAuth, requireRole(readers), controller.getRack);
router.patch('/racks/:id', requireAuth, requireRole(managers), controller.updateRack);
router.delete('/racks/:id', requireAuth, requireRole(managers), controller.deleteRack);
router.post('/racks/:id/restore', requireAuth, requireRole(managers), controller.restoreRack);

router.get('/rack-cells', requireAuth, requireRole(readers), controller.listCells);
router.get('/rack-cells/:id', requireAuth, requireRole(readers), controller.getCell);
router.patch('/rack-cells/:id', requireAuth, requireRole(managers), controller.updateCell);

export default router;
