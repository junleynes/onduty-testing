
export type UserRole = 'admin' | 'manager' | 'member';

export type AppVisibility = {
  schedule?: boolean;
  onDuty?: boolean;
  orgChart?: boolean;
  mobileLoad?: boolean;
};

export type Employee = {
  id: string;
  employeeNumber?: string;
  personnelNumber?: string;
  firstName: string;
  lastName: string;
  middleInitial?: string;
  email: string;
  phone: string;
  password?: string | null;
  birthDate?: Date;
  startDate?: Date;
  lastPromotionDate?: Date;
  position: string;
  role: UserRole;
  group?: string;
  avatar?: string;
  signature?: string;
  loadAllocation?: number;
  reportsTo?: string | null;
  visibility?: AppVisibility;
  gender?: 'Male' | 'Female';
  employeeClassification?: 'Rank-and-File' | 'Confidential' | 'Managerial';
};

export type Shift = {
  id:string;
  employeeId: string | null; // null for unassigned
  label: string;
  startTime: string; // e.g., "09:00"
  endTime: string; // e.g., "17:00"
  date: Date;
  color?: string;
  isDayOff?: boolean;
  isHolidayOff?: boolean;
  status?: 'draft' | 'published';
  breakStartTime?: string;
  breakEndTime?: string;
  isUnpaidBreak?: boolean;
};

export type LeaveType = string;

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected';

export type Leave = {
  id: string;
  employeeId: string;
  type: LeaveType;
  color?: string;
  startDate: Date;
  endDate: Date;
  isAllDay: boolean;
  startTime?: string;
  endTime?: string;
  status: LeaveRequestStatus;
  reason?: string;
  requestedAt?: Date;
  managedBy?: string; // ID of manager who approved/rejected
  managedAt?: Date;
  originalShiftDate?: Date;
  originalStartTime?: string;
  originalEndTime?: string;
  workExtensionStatus?: 'not-claimed' | 'claimed' | 'expired';
  claimedWorkExtensionId?: string;

  // New fields for PDF generation
  dateFiled: Date;
  department?: string;
  idNumber?: string;
  contactInfo?: string;
  employeeSignature?: string; // base64
  managerSignature?: string; // base64
  pdfDataUri?: string; // base64
};

export type Notification = {
  id: string;
  message: string;
  timestamp: Date;
  isRead: boolean;
  employeeId?: string; // Optional: for user-specific notifications
  link?: string; // Optional: for linking to a specific page
};

export type Note = {
    id: string;
    date: Date;
    title: string;
    description: string;
};

export type Holiday = {
    id: string;
    date: Date;
    title: string;
};

export type Task = {
  id: string;
  shiftId?: string | null; // Optional: for shift-specific tasks
  assigneeId?: string | null; // Optional: for personal tasks
  scope: 'personal' | 'global' | 'shift';
  title: string;
  description: string;
  status: 'pending' | 'acknowledged' | 'completed';
  acknowledgedAt?: Date;
  completedAt?: Date;
  dueDate?: Date;
  createdBy: string; // Employee ID
};

export type CommunicationAllowance = {
  id: string;
  employeeId: string;
  year: number;
  month: number; // 0-11
  balance: number;
  asOfDate?: Date;
  screenshot?: string; // base64 string
};

export type SmtpSettings = {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromEmail?: string;
  fromName?: string;
};

export type TardyRecord = {
  employeeId: string;
  employeeName: string;
  date: Date;
  schedule: string;
  timeIn: string;
  timeOut: string;
  remarks: string;
}

export type NavItemKey = 
  | 'dashboard' | 'my-schedule' | 'my-tasks'
  | 'schedule' | 'onduty' | 'time-off' | 'work-extensions' | 'allowance' | 'task-manager'
  | 'team' | 'org-chart' | 'celebrations' | 'holidays'
  | 'faq'
  | 'reports'
  | 'report-work-schedule' | 'report-attendance' | 'report-user-summary' | 'report-tardy' | 'report-wfh' | 'report-work-extension' | 'report-overtime' | 'report-alaf' | 'report-offset'
  | 'admin' | 'smtp-settings' | 'permissions' | 'danger-zone';

export type RolePermissions = {
  [key in UserRole]: NavItemKey[];
};
