import { Router } from 'express';
import * as StatisticsExportController from '../controllers/statistics/statistics-export.controller';

const router = Router();
router.get('/csv', StatisticsExportController.csv);
router.get('/xlsx', StatisticsExportController.xlsx);
router.get('/pdf', StatisticsExportController.pdf);
export default router;
