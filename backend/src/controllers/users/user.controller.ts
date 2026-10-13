import { Request, Response, NextFunction } from 'express';
import { UserService } from '../../services/users/user.service';
import { AuditService } from '../../services/audit/audit.service';
import { ActionType } from '../../types/audit.type';
import { FacilityAssignmentService, FacilityAssignmentError } from '../../services/users/facility-assignment.service';

export const registerCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, displayName, phone } = req.body;
    const user = await UserService.registerCustomer(email, password, displayName, phone);

    AuditService.logAction({
      actorId: user._id.toString(),
      actorRole: user.role,
      action: ActionType.REGISTER,
      entityType: 'User',
      entityId: user._id.toString(),
      after: user.toObject(),
    });

    res.status(201).json({ success: true, data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  res.status(200).json({ success: true, data: req.user });
};

export const updateMyProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { displayName, phone } = req.body;
    const actor = req.user as any;
    const user = await UserService.updateMyProfile(actor.keycloakSub, displayName, phone);

    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.UPDATE_PROFILE,
      entityType: 'User',
      entityId: actor._id.toString(),
      after: { displayName, phone },
    });

    res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const changeMyPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    const actor = req.user as any;
    await UserService.changeMyPassword(actor.keycloakSub, actor.email, oldPassword, newPassword);

    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.CHANGE_PASSWORD,
      entityType: 'User',
      entityId: actor._id.toString(),
    });

    res.status(200).json({ success: true, message: 'Đổi mật khẩu thành công' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminCreateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, displayName, role, phone } = req.body;
    const user = await UserService.adminCreateUser(email, password, displayName, role, phone);
    const actor = req.user as any;

    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.ADMIN_CREATE_USER,
      entityType: 'User',
      entityId: user._id.toString(),
      after: user.toObject(),
    });

    res.status(201).json({ success: true, data: user });
  } catch (error: any) {
    if (error.message.includes('ADMIN')) {
      res.status(403).json({ success: false, message: error.message });
      return;
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminUpdateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { displayName, phone, email } = req.body;
    const user = await UserService.adminUpdateUser(id, displayName, phone, email);
    const actor = req.user as any;

    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.ADMIN_UPDATE_USER,
      entityType: 'User',
      entityId: id,
      after: { displayName, phone, email },
    });

    res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminUpdateRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { role } = req.body;
    const user = await UserService.adminUpdateRole(id, role);
    const actor = req.user as any;

    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.ADMIN_UPDATE_ROLE,
      entityType: 'User',
      entityId: id,
      after: { role },
    });

    res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    if (error.message.includes('ADMIN')) {
      res.status(403).json({ success: false, message: error.message });
      return;
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminSoftDelete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const user = await UserService.adminSoftDelete(id);
    const actor = req.user as any;

    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.ADMIN_SOFT_DELETE,
      entityType: 'User',
      entityId: id,
      after: { isActive: false },
    });

    res.status(200).json({ success: true, message: 'Đã khóa tài khoản thành công', data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminReactivateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const user = await UserService.adminReactivateUser(id);
    const actor = req.user as any;

    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.ADMIN_RESTORE_USER,
      entityType: 'User',
      entityId: id,
      after: { isActive: true },
    });

    res.status(200).json({ success: true, message: 'Đã mở khóa tài khoản thành công', data: user });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const adminGetUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await UserService.adminGetUsers();
    res.status(200).json({ success: true, data: users });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const assignFacility = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await FacilityAssignmentService.assign(req.params.userId as string, req.body, req.user);
    res.status(200).json({ success: true, data: result });
  } catch (error: unknown) {
    const status = error instanceof FacilityAssignmentError ? error.status : 500;
    res.status(status).json({ success: false, message: error instanceof FacilityAssignmentError ? error.message : 'Internal Server Error' });
  }
};

export const unassignFacility = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await FacilityAssignmentService.unassign(req.params.userId as string, req.user);
    res.status(200).json({ success: true, data: result });
  } catch (error: unknown) {
    const status = error instanceof FacilityAssignmentError ? error.status : 500;
    res.status(status).json({ success: false, message: error instanceof FacilityAssignmentError ? error.message : 'Internal Server Error' });
  }
};
