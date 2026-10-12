import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { keycloakConfig } from '../../config/keycloak.config';
import UserModel from '../../models/users/user.model';
import { IUser } from '../../types/user.type';

// Mở rộng Request interface để Express hiểu thuộc tính `user`
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      tokenPayload?: any;
    }
  }
}

// Khởi tạo JWKS loader để fetch public keys từ server Keycloak
const JWKS = createRemoteJWKSet(new URL(keycloakConfig.jwksUri));

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ success: false, message: 'Unauthorized: Token format is invalid' });
      return;
    }

    // Verify token từ JWT của Keycloak
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: keycloakConfig.issuer,
    });

    // Sub chính là ID của Keycloak
    const keycloakSub = payload.sub;
    if (!keycloakSub) {
      res.status(401).json({ success: false, message: 'Unauthorized: Invalid token payload' });
      return;
    }

    // Tìm User tương ứng trong database nội bộ
    const user = await UserModel.findOne({ keycloakSub });

    if (!user) {
      res.status(401).json({ success: false, message: 'User does not exist in local database' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị khóa hoặc vô hiệu hóa.' });
      return;
    }

    req.user = user;
    req.tokenPayload = payload;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired token', error });
  }
};
