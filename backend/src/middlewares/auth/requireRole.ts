import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../../types/user.type';

/**
 * Middleware để kiểm tra Role.
 * Chú ý: Middleware này phải được gọi ngay sau `requireAuth` trong Route.
 */
export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthorized: User not found in request' });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({ 
        success: false, 
        message: `Forbidden: Requires one of these roles: ${allowedRoles.join(', ')}` 
      });
      return;
    }

    next();
  };
};
