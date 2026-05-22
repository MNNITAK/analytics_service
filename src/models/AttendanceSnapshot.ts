import mongoose, { Document, Schema } from 'mongoose';

export interface IAttendanceSnapshot extends Document {
  userId: string;
  college?: string;
  branch?: string;
  year?: string;
  section?: string;
  subject: string;
  date: Date;
  percentage: number;
  presentCount: number;
  totalCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceSnapshotSchema = new Schema<IAttendanceSnapshot>(
  {
    userId: { type: String, required: true },
    college: { type: String },
    branch: { type: String },
    year: { type: String },
    section: { type: String },
    subject: { type: String, required: true },
    date: { type: Date, required: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    presentCount: { type: Number, required: true, min: 0 },
    totalCount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

// Compound index for efficient per-user, per-subject, per-date queries
AttendanceSnapshotSchema.index({ userId: 1, subject: 1, date: -1 });
AttendanceSnapshotSchema.index({ userId: 1, date: -1 });

// For section-level analytics
AttendanceSnapshotSchema.index({ college: 1, branch: 1, year: 1, section: 1, date: -1 });

const AttendanceSnapshot = mongoose.model<IAttendanceSnapshot>(
  'AttendanceSnapshot',
  AttendanceSnapshotSchema
);

export default AttendanceSnapshot;
