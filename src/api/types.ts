// Work Launcher V2 API レスポンス型
// admin-console schema.prisma と同期

export type SectionType = "URL" | "FILE" | "MIXED";
export type ItemTargetType = "URL" | "FILE_LOCAL";
export type ShareTargetType = "USER" | "TENANT" | "ROLE";
export type SharePermission = "READ" | "CLONE";

export type LauncherItem = {
  id: string;
  sectionId: string;
  name: string;
  target: string;
  targetType: ItemTargetType;
  icon: string | null;
  sortOrder: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LauncherSection = {
  id: string;
  tenantUserId: string;
  name: string;
  type: SectionType;
  color: string;
  sortOrder: number;
  isVisible: boolean;
  isFromTemplate: boolean;
  templateSourceId: string | null;
  createdAt: string;
  updatedAt: string;
  items: LauncherItem[];
};

export type LauncherMemo = {
  id: string;
  tenantUserId: string;
  title: string | null;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type LauncherTask = {
  id: string;
  tenantUserId: string;
  title: string;
  dueDate: string | null;
  isAllDay: boolean;
  completedAt: string | null;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LauncherShare = {
  id: string;
  ownerId: string;
  targetType: ShareTargetType;
  targetId: string;
  sectionId: string;
  permission: SharePermission;
  isTemplate: boolean;
  createdAt: string;
  section: LauncherSection;
};

export type LauncherConfig = {
  etag: string;
  sections: LauncherSection[];
  memos: LauncherMemo[];
  tasks: LauncherTask[];
  shared: LauncherShare[];
};
