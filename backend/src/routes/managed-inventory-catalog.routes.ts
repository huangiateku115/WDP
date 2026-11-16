import { Router } from 'express';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';
import * as controller from '../controllers/inventory-items/managed-inventory-catalog.controller';

const router = Router();
const managers = requireRole([UserRole.ADMIN, UserRole.BOM]);
const selectors = requireRole([UserRole.ADMIN, UserRole.BOM, UserRole.CUSTOMER]);
router.use(requireAuth);

router.get('/categories/active', selectors, controller.activeCategories);
router.get('/categories', managers, controller.listCategories);
router.post('/categories', managers, controller.createCategory);
router.get('/categories/:id', managers, controller.getCategory);
router.patch('/categories/:id', managers, controller.updateCategory);
router.delete('/categories/:id', managers, controller.removeCategory);

router.get('/quantity-units/active', selectors, controller.activeQuantityUnits);
router.get('/quantity-units', managers, controller.listQuantityUnits);
router.post('/quantity-units', managers, controller.createQuantityUnit);
router.get('/quantity-units/:id', managers, controller.getQuantityUnit);
router.patch('/quantity-units/:id', managers, controller.updateQuantityUnit);
router.delete('/quantity-units/:id', managers, controller.removeQuantityUnit);

export default router;
