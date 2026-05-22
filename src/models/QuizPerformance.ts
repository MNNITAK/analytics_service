import mongoose, { Document, Schema } from 'mongoose';

export interface IQuizPerformance extends Document {
  userId: string;
  fileId: string;
  subject: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  takenAt: Date;
  createdAt: Date;
}

const QuizPerformanceSchema = new Schema<IQuizPerformance>(
  {
    userId: { type: String, required: true },
    fileId: { type: String, required: true },
    subject: { type: String, required: true },
    score: { type: Number, required: true, min: 0 },
    totalQuestions: { type: Number, required: true, min: 1 },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    takenAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

QuizPerformanceSchema.index({ userId: 1, subject: 1 });
QuizPerformanceSchema.index({ userId: 1, takenAt: -1 });

const QuizPerformance = mongoose.model<IQuizPerformance>('QuizPerformance', QuizPerformanceSchema);

export default QuizPerformance;
