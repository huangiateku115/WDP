export enum ActionType {
  REGISTER = 'REGISTER',
  UPDATE_PROFILE = 'UPDATE_PROFILE',
  CHANGE_PASSWORD = 'CHANGE_PASSWORD',
  ADMIN_CREATE_USER = 'ADMIN_CREATE_USER',
  ADMIN_UPDATE_USER = 'ADMIN_UPDATE_USER',
  ADMIN_UPDATE_ROLE = 'ADMIN_UPDATE_ROLE',
  ADMIN_SOFT_DELETE = 'ADMIN_SOFT_DELETE',
  ADMIN_RESTORE_USER = 'ADMIN_RESTORE_USER',
}

export enum LoginEventType {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
}

export enum LoginStatus {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

export enum LoginFailureReason {
  WRONG_CREDENTIALS = 'WRONG_CREDENTIALS',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  ACCOUNT_NOT_SYNCED = 'ACCOUNT_NOT_SYNCED',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
}

export interface IAuditLog {
  actorId: string;
  actorRole: string;
  action: ActionType;
  entityType: string;
  entityId: string;
  before?: any;
  after?: any;
  facilityId?: string;
  reason?: string;
}

export interface ILoginHistory {
  userId?: string;
  attemptedEmail?: string;
  eventType: LoginEventType;
  status: LoginStatus;
  failureReason?: LoginFailureReason;
  ip?: string;
  device?: string;
}
