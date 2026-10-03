import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { keycloakConfig } from '../../config/keycloak.config';

const JWKS = createRemoteJWKSet(new URL(keycloakConfig.jwksUri));

export const verifyTokenOnly = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: keycloakConfig.issuer,
    });

    if (!payload.sub) {
      res.status(401).json({ success: false, message: 'Unauthorized: Invalid token payload' });
      return;
    }

    req.tokenPayload = payload;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired token', error });
  }
};
