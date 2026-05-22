import mongoose from 'mongoose';

const connectDB = async (): Promise<void> => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI environment variable is not set');
  }

  try {
    await mongoose.connect(uri);
    console.log('[AnalyticsService] MongoDB connected successfully');

    mongoose.connection.on('error', (err) => {
      console.error('[AnalyticsService] MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[AnalyticsService] MongoDB disconnected. Attempting to reconnect...');
    });
  } catch (error) {
    console.error('[AnalyticsService] Failed to connect to MongoDB:', error);
    throw error;
  }
};

export default connectDB;
