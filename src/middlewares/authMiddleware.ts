import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: string;
  email: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // API Gateway forwards decoded user info in headers
  const userIdHeader = req.headers['x-user-id'] as string | undefined;
  const emailHeader = req.headers['x-user-email'] as string | undefined;
  const roleHeader = req.headers['x-user-role'] as string | undefined;

  if (userIdHeader) {
    // Request came through the API Gateway — trust the forwarded headers
    req.user = {
      userId: userIdHeader,
      email: emailHeader ?? '',
      role: roleHeader,
    };
    next();
    return;
  }

  // Direct access: validate JWT ourselves (for development/testing)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No authorization token provided' });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error('[AnalyticsService] JWT_SECRET not set');
    res.status(500).json({ success: false, message: 'Server configuration error' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as AuthPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, message: 'Token expired' });
    } else {
      res.status(401).json({ success: false, message: 'Invalid token' });
    }
  }
};
