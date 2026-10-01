import { Request, Response, NextFunction } from 'express';

export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // req.user đã được gán bởi middleware requireAuth
    const user = req.user;
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};
