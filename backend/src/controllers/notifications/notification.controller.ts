import { Request, Response } from 'express';
import NotificationModel from '../../models/notifications/notification.model';

export const getMyNotifications = async (req: Request, res: Response) => {
  try {
    const notifications = await NotificationModel.find({ userId: req.user!._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: notifications });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const notification = await NotificationModel.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id } as any,
      { isRead: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    return res.json({ success: true, data: notification });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
