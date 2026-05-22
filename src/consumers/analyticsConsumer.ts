import { ConsumeMessage } from 'amqplib';
import { consumeEvent } from '../utils/rabbitmq';
import AttendanceSnapshot from '../models/AttendanceSnapshot';
import QuizPerformance from '../models/QuizPerformance';
import StudyActivity from '../models/StudyActivity';
import DeadlineStat from '../models/DeadlineStat';

const ANALYTICS_QUEUE = 'analytics-queue';

const ROUTING_KEYS = [
  'attendance.saved',
  'ai.quiz_completed',
  'deadline.completed',
  'chat.message_sent',
  'study.file_uploaded',
  'study.note_created',
];

type EventPayload = Record<string, unknown>;

/**
 * Returns the start of a given date (midnight UTC) for day-level bucketing.
 */
const startOfDay = (date: Date = new Date()): Date => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Idempotent upsert for daily study activity.
 * Uses $inc so repeated events correctly accumulate.
 */
const incrementStudyActivity = async (
  userId: string,
  field: 'filesUploaded' | 'quizzesTaken' | 'chatMessages' | 'notesCreated',
  amount = 1
): Promise<void> => {
  const today = startOfDay();
  await StudyActivity.findOneAndUpdate(
    { userId, date: today },
    { $inc: { [field]: amount } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const handleAttendanceSaved = async (payload: EventPayload): Promise<void> => {
  const {
    userId,
    subject,
    date,
    percentage,
    presentCount,
    totalCount,
    college,
    branch,
    year,
    section,
  } = payload as {
    userId: string;
    subject: string;
    date: string;
    percentage: number;
    presentCount: number;
    totalCount: number;
    college?: string;
    branch?: string;
    year?: string;
    section?: string;
  };

  const recordDate = date ? startOfDay(new Date(date)) : startOfDay();

  // Upsert: if a snapshot for this user+subject+date exists, update it
  await AttendanceSnapshot.findOneAndUpdate(
    { userId, subject, date: recordDate },
    {
      $set: {
        userId,
        subject,
        date: recordDate,
        percentage,
        presentCount,
        totalCount,
        ...(college && { college }),
        ...(branch && { branch }),
        ...(year && { year }),
        ...(section && { section }),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`[AnalyticsService][Consumer] attendance.saved: user=${userId}, subject=${subject}, ${percentage.toFixed(1)}%`);
};

const handleQuizCompleted = async (payload: EventPayload): Promise<void> => {
  const { userId, fileId, subject, score, totalQuestions, takenAt } = payload as {
    userId: string;
    fileId: string;
    subject: string;
    score: number;
    totalQuestions: number;
    takenAt?: string;
  };

  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

  await QuizPerformance.create({
    userId,
    fileId,
    subject,
    score,
    totalQuestions,
    percentage,
    takenAt: takenAt ? new Date(takenAt) : new Date(),
  });

  await incrementStudyActivity(userId, 'quizzesTaken');

  console.log(`[AnalyticsService][Consumer] ai.quiz_completed: user=${userId}, subject=${subject}, score=${score}/${totalQuestions}`);
};

const handleDeadlineCompleted = async (payload: EventPayload): Promise<void> => {
  const { userId, deadlineId, subject, dueDate, completedAt } = payload as {
    userId: string;
    deadlineId: string;
    subject?: string;
    dueDate?: string;
    completedAt?: string;
  };

  const completedDate = completedAt ? new Date(completedAt) : new Date();
  const dueDateTime = dueDate ? new Date(dueDate) : completedDate;

  const diffMs = completedDate.getTime() - dueDateTime.getTime();
  const daysLate = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const completedOnTime = daysLate <= 0;

  // Idempotent: use upsert to prevent duplicates from re-delivery
  await DeadlineStat.findOneAndUpdate(
    { deadlineId },
    {
      $setOnInsert: {
        userId,
        deadlineId,
        subject: subject ?? 'General',
        completedOnTime,
        daysLate,
        completedAt: completedDate,
      },
    },
    { upsert: true, new: true }
  );

  console.log(`[AnalyticsService][Consumer] deadline.completed: user=${userId}, onTime=${completedOnTime}, daysLate=${daysLate}`);
};

const handleChatMessageSent = async (payload: EventPayload): Promise<void> => {
  const { userId } = payload as { userId: string };
  await incrementStudyActivity(userId, 'chatMessages');
};

const handleFileUploaded = async (payload: EventPayload): Promise<void> => {
  const { userId } = payload as { userId: string };
  await incrementStudyActivity(userId, 'filesUploaded');
};

const handleNoteCreated = async (payload: EventPayload): Promise<void> => {
  const { userId } = payload as { userId: string };
  await incrementStudyActivity(userId, 'notesCreated');
};

export const startAnalyticsConsumers = async (): Promise<void> => {
  await consumeEvent(
    ANALYTICS_QUEUE,
    ROUTING_KEYS,
    async (routingKey: string, payload: EventPayload, _msg: ConsumeMessage): Promise<void> => {
      switch (routingKey) {
        case 'attendance.saved':
          await handleAttendanceSaved(payload);
          break;
        case 'ai.quiz_completed':
          await handleQuizCompleted(payload);
          break;
        case 'deadline.completed':
          await handleDeadlineCompleted(payload);
          break;
        case 'chat.message_sent':
          await handleChatMessageSent(payload);
          break;
        case 'study.file_uploaded':
          await handleFileUploaded(payload);
          break;
        case 'study.note_created':
          await handleNoteCreated(payload);
          break;
        default:
          console.warn(`[AnalyticsService][Consumer] Unhandled routing key: ${routingKey}`);
      }
    }
  );
};
