import { Request, Response } from 'express';
import AttendanceSnapshot from '../models/AttendanceSnapshot';
import QuizPerformance from '../models/QuizPerformance';
import StudyActivity from '../models/StudyActivity';
import DeadlineStat from '../models/DeadlineStat';

// GET /api/analytics/attendance
// Query: ?startDate=ISO&endDate=ISO&subject=
export const getAttendanceAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { startDate, endDate, subject } = req.query as {
      startDate?: string;
      endDate?: string;
      subject?: string;
    };

    const filter: Record<string, unknown> = { userId };

    if (subject) filter.subject = subject;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    filter.date = { $gte: start, $lte: end };

    const snapshots = await AttendanceSnapshot.find(filter)
      .sort({ date: 1 })
      .select('subject date percentage presentCount totalCount -_id');

    // Group by subject for multi-line chart data
    const grouped: Record<string, Array<{ date: string; percentage: number; present: number; total: number }>> = {};
    for (const snap of snapshots) {
      const key = snap.subject;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        date: snap.date.toISOString().split('T')[0],
        percentage: snap.percentage,
        present: snap.presentCount,
        total: snap.totalCount,
      });
    }

    // Summary per subject
    const subjects = Object.keys(grouped);
    const summary = subjects.map((sub) => {
      const data = grouped[sub];
      const latest = data[data.length - 1];
      const avg = data.reduce((acc, d) => acc + d.percentage, 0) / data.length;
      return {
        subject: sub,
        latestPercentage: latest?.percentage ?? 0,
        averagePercentage: Math.round(avg * 10) / 10,
        dataPoints: data.length,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        trend: grouped,
        summary,
        dateRange: {
          start: start.toISOString().split('T')[0],
          end: end.toISOString().split('T')[0],
        },
      },
    });
  } catch (error) {
    console.error('[AnalyticsService] getAttendanceAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /api/analytics/quiz
export const getQuizAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { subject } = req.query as { subject?: string };

    const filter: Record<string, unknown> = { userId };
    if (subject) filter.subject = subject;

    const quizzes = await QuizPerformance.find(filter)
      .sort({ takenAt: 1 })
      .select('subject score totalQuestions percentage takenAt fileId -_id');

    // Group by subject
    const grouped: Record<
      string,
      Array<{ date: string; score: number; total: number; percentage: number; fileId: string }>
    > = {};
    for (const q of quizzes) {
      const key = q.subject;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        date: q.takenAt.toISOString(),
        score: q.score,
        total: q.totalQuestions,
        percentage: q.percentage,
        fileId: q.fileId,
      });
    }

    // Per-subject summary stats
    const subjectSummary = Object.entries(grouped).map(([sub, data]) => {
      const avg = data.reduce((acc, d) => acc + d.percentage, 0) / data.length;
      const latest = data[data.length - 1];
      const best = data.reduce((prev, curr) => (curr.percentage > prev.percentage ? curr : prev), data[0]);
      return {
        subject: sub,
        quizzesTaken: data.length,
        averagePercentage: Math.round(avg * 10) / 10,
        latestPercentage: latest?.percentage ?? 0,
        bestPercentage: best?.percentage ?? 0,
        improving: data.length >= 2 ? (data[data.length - 1].percentage > data[0].percentage) : null,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        trend: grouped,
        summary: subjectSummary,
        totalQuizzes: quizzes.length,
      },
    });
  } catch (error) {
    console.error('[AnalyticsService] getQuizAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /api/analytics/activity
// Returns daily activity heatmap data for last 90 days
export const getActivityHeatmap = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    ninetyDaysAgo.setUTCHours(0, 0, 0, 0);

    const activities = await StudyActivity.find({
      userId,
      date: { $gte: ninetyDaysAgo },
    })
      .sort({ date: 1 })
      .select('date filesUploaded quizzesTaken chatMessages notesCreated -_id');

    // Build a complete 90-day map (fill missing days with zeros)
    const activityMap: Record<string, {
      date: string;
      filesUploaded: number;
      quizzesTaken: number;
      chatMessages: number;
      notesCreated: number;
      totalActivity: number;
    }> = {};

    // Fill existing data
    for (const a of activities) {
      const key = a.date.toISOString().split('T')[0];
      const total = a.filesUploaded + a.quizzesTaken + a.chatMessages + a.notesCreated;
      activityMap[key] = {
        date: key,
        filesUploaded: a.filesUploaded,
        quizzesTaken: a.quizzesTaken,
        chatMessages: a.chatMessages,
        notesCreated: a.notesCreated,
        totalActivity: total,
      };
    }

    const heatmapData = Object.values(activityMap);

    // Summary
    const totalActivity = heatmapData.reduce((acc, d) => acc + d.totalActivity, 0);
    const activeDays = heatmapData.filter((d) => d.totalActivity > 0).length;
    const streak = calculateStreak(heatmapData);

    res.status(200).json({
      success: true,
      data: {
        heatmap: heatmapData,
        summary: {
          totalActivity,
          activeDays,
          currentStreak: streak,
        },
      },
    });
  } catch (error) {
    console.error('[AnalyticsService] getActivityHeatmap error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const calculateStreak = (
  data: Array<{ date: string; totalActivity: number }>
): number => {
  if (data.length === 0) return 0;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let streak = 0;
  let current = new Date(today);

  const dateSet = new Set(
    data.filter((d) => d.totalActivity > 0).map((d) => d.date)
  );

  while (true) {
    const key = current.toISOString().split('T')[0];
    if (dateSet.has(key)) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
};

// GET /api/analytics/overview
export const getOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [attendanceData, quizData, activityData, deadlineData] = await Promise.all([
      // Latest attendance per subject
      AttendanceSnapshot.aggregate([
        { $match: { userId } },
        { $sort: { date: -1 } },
        {
          $group: {
            _id: '$subject',
            latestPercentage: { $first: '$percentage' },
          },
        },
      ]),

      // Quiz stats for last 30 days
      QuizPerformance.aggregate([
        { $match: { userId, takenAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: null,
            totalQuizzes: { $sum: 1 },
            avgScore: { $avg: '$percentage' },
          },
        },
      ]),

      // Activity totals for last 30 days
      StudyActivity.aggregate([
        { $match: { userId, date: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: null,
            totalFiles: { $sum: '$filesUploaded' },
            totalNotes: { $sum: '$notesCreated' },
            totalMessages: { $sum: '$chatMessages' },
          },
        },
      ]),

      // Deadline completion rate
      DeadlineStat.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            onTime: { $sum: { $cond: ['$completedOnTime', 1, 0] } },
          },
        },
      ]),
    ]);

    const avgAttendance =
      attendanceData.length > 0
        ? Math.round(
            (attendanceData.reduce((acc, s) => acc + (s.latestPercentage as number), 0) /
              attendanceData.length) *
              10
          ) / 10
        : 0;

    const quiz = quizData[0] as { totalQuizzes: number; avgScore: number } | undefined;
    const activity = activityData[0] as {
      totalFiles: number;
      totalNotes: number;
      totalMessages: number;
    } | undefined;
    const deadline = deadlineData[0] as { total: number; onTime: number } | undefined;

    const deadlineCompletionRate =
      deadline && deadline.total > 0
        ? Math.round((deadline.onTime / deadline.total) * 100)
        : null;

    res.status(200).json({
      success: true,
      data: {
        attendance: {
          averagePercentage: avgAttendance,
          subjectsTracked: attendanceData.length,
        },
        quizzes: {
          takenLast30Days: quiz?.totalQuizzes ?? 0,
          averageScore: quiz ? Math.round((quiz.avgScore ?? 0) * 10) / 10 : 0,
        },
        activity: {
          filesUploadedLast30Days: activity?.totalFiles ?? 0,
          notesCreatedLast30Days: activity?.totalNotes ?? 0,
          chatMessagesLast30Days: activity?.totalMessages ?? 0,
        },
        deadlines: {
          completionRate: deadlineCompletionRate,
          totalCompleted: deadline?.total ?? 0,
          onTime: deadline?.onTime ?? 0,
        },
      },
    });
  } catch (error) {
    console.error('[AnalyticsService] getOverview error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /api/analytics/section  (CR only — role check)
export const getSectionAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (role !== 'cr' && role !== 'admin') {
      res.status(403).json({ success: false, message: 'Access restricted to Class Representatives' });
      return;
    }

    const { college, branch, year, section } = req.query as {
      college?: string;
      branch?: string;
      year?: string;
      section?: string;
    };

    if (!college || !branch || !year || !section) {
      res.status(400).json({
        success: false,
        message: 'Query params required: college, branch, year, section',
      });
      return;
    }

    const filter: Record<string, string> = { college, branch, year, section };

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const sectionAttendance = await AttendanceSnapshot.aggregate([
      {
        $match: {
          ...filter,
          date: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: { subject: '$subject', date: '$date' },
          avgPercentage: { $avg: '$percentage' },
          studentCount: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1 } },
    ]);

    const subjectBreakdown = await AttendanceSnapshot.aggregate([
      {
        $match: { ...filter },
      },
      { $sort: { date: -1 } },
      {
        $group: {
          _id: '$subject',
          latestAvgPercentage: { $first: '$percentage' },
          studentsBelow75: {
            $sum: { $cond: [{ $lt: ['$percentage', 75] }, 1, 0] },
          },
          totalStudents: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        section: { college, branch, year, section },
        attendanceTrend: sectionAttendance,
        subjectBreakdown,
        period: '30 days',
      },
    });
  } catch (error) {
    console.error('[AnalyticsService] getSectionAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
