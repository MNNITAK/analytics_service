import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  getAttendanceAnalytics,
  getQuizAnalytics,
  getActivityHeatmap,
  getOverview,
  getSectionAnalytics,
} from '../controllers/analyticsController';

const router = Router();

// All analytics routes require authentication
router.use(authMiddleware);

router.get('/attendance', getAttendanceAnalytics);
router.get('/quiz', getQuizAnalytics);
router.get('/activity', getActivityHeatmap);
router.get('/overview', getOverview);
router.get('/section', getSectionAnalytics);

export default router;
