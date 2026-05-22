import mongoose, { Document, Schema } from 'mongoose';

export interface IStudyActivity extends Document {
  userId: string;
  date: Date; // normalized to start of day
  filesUploaded: number;
  quizzesTaken: number;
  chatMessages: number;
  notesCreated: number;
  createdAt: Date;
  updatedAt: Date;
}

const StudyActivitySchema = new Schema<IStudyActivity>(
  {
    userId: { type: String, required: true },
    date: { type: Date, required: true },
    filesUploaded: { type: Number, default: 0, min: 0 },
    quizzesTaken: { type: Number, default: 0, min: 0 },
    chatMessages: { type: Number, default: 0, min: 0 },
    notesCreated: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Unique constraint: one activity document per user per day
StudyActivitySchema.index({ userId: 1, date: 1 }, { unique: true });
StudyActivitySchema.index({ userId: 1, date: -1 });

const StudyActivity = mongoose.model<IStudyActivity>('StudyActivity', StudyActivitySchema);

export default StudyActivity;
