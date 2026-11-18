import { Request, Response } from 'express';
import { AuditLogModel } from '../../models/audit/audit.model';
import { LoginHistoryModel } from '../../models/audit/loginHistory.model';
import UserModel from '../../models/users/user.model';
import { UserRole } from '../../types/user.type';
import { AuditService } from '../../services/audit/audit.service';
import { AuditReadError } from '../../services/audit/audit-read.validation';

const sendReadError = (res: Response, error: unknown) => {
  if (error instanceof AuditReadError) {
    res.status(error.status).json({ success: false, code: error.code, message: error.message });
    return;
  }
  res.status(500).json({ success: false, code: 'AUDIT_READ_FAILED', message: 'Unable to read Audit data' });
};

export const getGlobalAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await AuditService.listLogs(req.query, req.user);
    res.status(200).json({ success: true, data: result });
  } catch (error) { sendReadError(res, error); }
};

export const getAuditSubjects = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await AuditService.listSubjects(req.query, req.user);
    res.status(200).json({ success: true, data: result });
  } catch (error) { sendReadError(res, error); }
};

// --- ADMIN APIs ---

export const adminGetLoginHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.userId as string;
    const history = await LoginHistoryModel.find({ userId } as any).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: history });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const adminGetAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.userId as string;
    // Lấy các thao tác do user này thực hiện
    const logs = await AuditLogModel.find({ actorId: userId } as any).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: logs.map(row => AuditService.auditDetailDto(row)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- BOM APIs ---

const checkBomPermission = async (targetUserId: string): Promise<void> => {
  const targetUser = await UserModel.findById(targetUserId);
  if (!targetUser) {
    throw new Error('User not found');
  }
  if (targetUser.role === UserRole.ADMIN || targetUser.role === UserRole.BOM) {
    throw new Error('BOM_FORBIDDEN: Không có quyền xem dữ liệu của cấp trên hoặc đồng cấp');
  }
};

export const bomGetLoginHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.userId as string;
    await checkBomPermission(userId);

    const history = await LoginHistoryModel.find({ userId } as any).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: history });
  } catch (error: any) {
    if (error.message.includes('BOM_FORBIDDEN')) {
      res.status(403).json({ success: false, message: error.message });
      return;
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

export const bomGetAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.userId as string;
    await checkBomPermission(userId);

    const logs = await AuditLogModel.find({ actorId: userId } as any).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: logs.map(row => AuditService.auditDetailDto(row)) });
  } catch (error: any) {
    if (error.message.includes('BOM_FORBIDDEN')) {
      res.status(403).json({ success: false, message: error.message });
      return;
    }
    res.status(400).json({ success: false, message: error.message });
  }
};
