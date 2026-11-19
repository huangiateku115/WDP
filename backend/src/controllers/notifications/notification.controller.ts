import { Request, Response } from 'express';
import NotificationModel from '../../models/notifications/notification.model';

function parseListQuery(query: Request['query']) {
  const pageRaw = query.page === undefined ? '1' : String(query.page);
  const limitRaw = query.limit === undefined ? '20' : String(query.limit);
  if (!/^\d+$/.test(pageRaw) || !/^\d+$/.test(limitRaw)) return null;
  const page = Number(pageRaw), limit = Number(limitRaw);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
  const read = query.read === undefined ? undefined : String(query.read);
  if (read !== undefined && read !== 'read' && read !== 'unread') return null;
  return { page, limit, read };
}

export const getMyNotifications = async (req: Request, res: Response) => {
  try {
    const parsed = parseListQuery(req.query);
    if (!parsed) return res.status(400).json({ success: false, message: 'Invalid notification pagination or read filter' });
    const filter: Record<string, unknown> = { userId: req.user!._id };
    if (parsed.read) filter.isRead = parsed.read === 'read';
    const [notifications, total] = await Promise.all([
      NotificationModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((parsed.page - 1) * parsed.limit).limit(parsed.limit).lean().exec(),
      NotificationModel.countDocuments(filter).exec(),
    ]);
    return res.json({ success: true, data: notifications, meta: { page: parsed.page, limit: parsed.limit, total, unreadCount: await NotificationModel.countDocuments({ userId: req.user!._id, isRead: false }).exec() } });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to load notifications' });
  }
};

export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const unreadCount = await NotificationModel.countDocuments({ userId: req.user!._id, isRead: false }).exec();
    return res.json({ success: true, data: { unreadCount } });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to load unread notification count' });
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const notification = await NotificationModel.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id } as any,
      { isRead: true },
      { returnDocument: 'after' }
    );
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    return res.json({ success: true, data: notification });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to update notification' });
  }
};
