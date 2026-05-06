// useLauncherData: 起動時 cache → API sync → 5分間隔再 sync
// 楽観的UI 更新用 setter も提供

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LauncherMemo,
  LauncherSection,
  LauncherShare,
  LauncherTask,
} from "../api/types";
import {
  loadCache,
  syncWithServer,
} from "../cache/launcher-cache";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type LauncherDataState = {
  etag: string | null;
  sections: LauncherSection[];
  memos: LauncherMemo[];
  tasks: LauncherTask[];
  shared: LauncherShare[];
  loading: boolean;
  error: string | null;
  lastSyncAt: number | null;
};

const EMPTY: LauncherDataState = {
  etag: null,
  sections: [],
  memos: [],
  tasks: [],
  shared: [],
  loading: false,
  error: null,
  lastSyncAt: null,
};

export function useLauncherData(loggedIn: boolean) {
  const [state, setState] = useState<LauncherDataState>({ ...EMPTY, loading: true });
  const etagRef = useRef<string | null>(null);

  const sync = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const result = await syncWithServer(etagRef.current);
    if (result.kind === "updated") {
      const c = result.cached;
      etagRef.current = c.etag;
      setState({
        etag: c.etag,
        sections: c.sections,
        memos: c.memos,
        tasks: c.tasks,
        shared: c.shared,
        loading: false,
        error: null,
        lastSyncAt: c.fetchedAt,
      });
    } else if (result.kind === "unchanged") {
      setState((prev) => ({
        ...prev,
        loading: false,
        lastSyncAt: result.cached?.fetchedAt ?? prev.lastSyncAt,
      }));
    } else {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: result.error.message,
      }));
    }
  }, []);

  useEffect(() => {
    if (!loggedIn) {
      etagRef.current = null;
      setState({ ...EMPTY });
      return;
    }
    let cancelled = false;
    loadCache().then((cached) => {
      if (cancelled) return;
      if (cached) {
        etagRef.current = cached.etag;
        setState({
          etag: cached.etag,
          sections: cached.sections,
          memos: cached.memos,
          tasks: cached.tasks,
          shared: cached.shared,
          loading: true, // 続けてsyncで上書き
          error: null,
          lastSyncAt: cached.fetchedAt,
        });
      }
      sync();
    });
    const id = window.setInterval(() => {
      sync();
    }, SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [loggedIn, sync]);

  // 楽観的更新 setter
  const setSections = useCallback(
    (next: LauncherSection[] | ((prev: LauncherSection[]) => LauncherSection[])) => {
      setState((p) => ({
        ...p,
        sections: typeof next === "function" ? (next as (prev: LauncherSection[]) => LauncherSection[])(p.sections) : next,
      }));
    },
    [],
  );
  const setMemos = useCallback(
    (next: LauncherMemo[] | ((prev: LauncherMemo[]) => LauncherMemo[])) => {
      setState((p) => ({
        ...p,
        memos: typeof next === "function" ? (next as (prev: LauncherMemo[]) => LauncherMemo[])(p.memos) : next,
      }));
    },
    [],
  );
  const setTasks = useCallback(
    (next: LauncherTask[] | ((prev: LauncherTask[]) => LauncherTask[])) => {
      setState((p) => ({
        ...p,
        tasks: typeof next === "function" ? (next as (prev: LauncherTask[]) => LauncherTask[])(p.tasks) : next,
      }));
    },
    [],
  );

  return { state, sync, setSections, setMemos, setTasks };
}
