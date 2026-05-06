// Work Launcher V2 API ヘルパー（CRUD関数群）
// 設計書: MyBrain/20_Projects/Work Launcher/設計書 v0.4 §4

import { apiPost, apiPut, apiDelete } from "./client";
import type {
  LauncherSection,
  LauncherItem,
  LauncherMemo,
  LauncherTask,
  ItemTargetType,
} from "./types";

// ============================================================
// Sections
// ============================================================
export async function apiCreateSection(input: {
  name: string;
  type?: string;
  color?: string;
}): Promise<LauncherSection> {
  const r = await apiPost<{ section: LauncherSection }>(
    "/api/work-launcher/sections",
    input,
  );
  return r.section;
}

export async function apiUpdateSection(
  id: string,
  patch: Partial<{
    name: string;
    type: string;
    color: string;
    sortOrder: number;
    isVisible: boolean;
  }>,
): Promise<LauncherSection> {
  const r = await apiPut<{ section: LauncherSection }>(
    `/api/work-launcher/sections/${id}`,
    patch,
  );
  return r.section;
}

export async function apiDeleteSection(id: string): Promise<void> {
  await apiDelete(`/api/work-launcher/sections/${id}`);
}

// ============================================================
// Items
// ============================================================
export async function apiCreateItem(input: {
  sectionId: string;
  name: string;
  target: string;
  targetType?: ItemTargetType;
  icon?: string;
}): Promise<LauncherItem> {
  const r = await apiPost<{ item: LauncherItem }>(
    "/api/work-launcher/items",
    input,
  );
  return r.item;
}

export async function apiUpdateItem(
  id: string,
  patch: Partial<{
    name: string;
    target: string;
    targetType: ItemTargetType;
    icon: string | null;
    sortOrder: number;
    sectionId: string;
  }>,
): Promise<LauncherItem> {
  const r = await apiPut<{ item: LauncherItem }>(
    `/api/work-launcher/items/${id}`,
    patch,
  );
  return r.item;
}

export async function apiDeleteItem(id: string): Promise<void> {
  await apiDelete(`/api/work-launcher/items/${id}`);
}

export async function apiTouchItem(id: string): Promise<void> {
  await apiPost(`/api/work-launcher/items/${id}/touch`);
}

// ============================================================
// Memos
// ============================================================
export async function apiCreateMemo(input: {
  title?: string;
  content: string;
}): Promise<LauncherMemo> {
  const r = await apiPost<{ memo: LauncherMemo }>(
    "/api/work-launcher/memos",
    input,
  );
  return r.memo;
}

export async function apiUpdateMemo(
  id: string,
  patch: Partial<{ title: string | null; content: string; sortOrder: number }>,
): Promise<LauncherMemo> {
  const r = await apiPut<{ memo: LauncherMemo }>(
    `/api/work-launcher/memos/${id}`,
    patch,
  );
  return r.memo;
}

export async function apiDeleteMemo(id: string): Promise<void> {
  await apiDelete(`/api/work-launcher/memos/${id}`);
}

// ============================================================
// Tasks
// ============================================================
export async function apiCreateTask(input: {
  title: string;
  dueDate?: string | null;
  isAllDay?: boolean;
}): Promise<LauncherTask> {
  const r = await apiPost<{ task: LauncherTask }>(
    "/api/work-launcher/tasks",
    input,
  );
  return r.task;
}

export async function apiUpdateTask(
  id: string,
  patch: Partial<{
    title: string;
    dueDate: string | null;
    isAllDay: boolean;
    completedAt: string | null;
    notifiedAt: string | null;
  }>,
): Promise<LauncherTask> {
  const r = await apiPut<{ task: LauncherTask }>(
    `/api/work-launcher/tasks/${id}`,
    patch,
  );
  return r.task;
}

export async function apiDeleteTask(id: string): Promise<void> {
  await apiDelete(`/api/work-launcher/tasks/${id}`);
}

// ============================================================
// Shared / Templates 受信側
// ============================================================
export async function apiCloneShared(shareId: string): Promise<LauncherSection> {
  const r = await apiPost<{ section: LauncherSection }>(
    `/api/work-launcher/shared/${shareId}/clone`,
  );
  return r.section;
}

// ============================================================
// Migrate
// ============================================================
export async function apiMigrateUpload(payload: unknown): Promise<{
  ok: boolean;
  imported: { sections: number; items: number; memos: number; tasks: number };
}> {
  return apiPost("/api/work-launcher/migrate/upload", payload);
}
