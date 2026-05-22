import mongoose, { Document, Schema } from 'mongoose';

export interface IDeadlineStat extends Document {
  userId: string;
  deadlineId: string;
  subject: string;
  completedOnTime: boolean;
  daysLate: number; // 0 if on time, positive = days late, negative = days early
  completedAt: Date;
  createdAt: Date;
}

const DeadlineStatSchema = new Schema<IDeadlineStat>(
  {
    userId: { type: String, required: true },
    deadlineId: { type: String, required: true },
    subject: { type: String, required: true, default: 'General' },
    completedOnTime: { type: Boolean, required: true },
    daysLate: { type: Number, required: true, default: 0 },
    completedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

DeadlineStatSchema.index({ userId: 1 });
DeadlineStatSchema.index({ userId: 1, completedAt: -1 });
// Prevent duplicate entries for the same deadline
DeadlineStatSchema.index({ deadlineId: 1 }, { unique: true });

const DeadlineStat = mongoose.model<IDeadlineStat>('DeadlineStat', DeadlineStatSchema);

export default DeadlineStat;
