import { Request, Response, NextFunction } from 'express';
import { syncUserWithKeycloak } from '../../services/auth/auth.service';

export const syncUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.tokenPayload;
    if (!payload) {
      res.status(400).json({ success: false, message: 'Token payload missing' });
      return;
    }

    const user = await syncUserWithKeycloak(payload);

    res.status(200).json({
      success: true,
      message: 'User synced successfully',
      data: user
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error while syncing user'
    });
  }
};
