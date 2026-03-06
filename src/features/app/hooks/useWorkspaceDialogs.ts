import { useCallback, useEffect, useRef, useState } from "react";
import { ask, message } from "@tauri-apps/plugin-dialog";
import type { WorkspaceInfo } from "@/types";
import { isAbsolutePath, isMobilePlatform } from "@utils/platformPaths";
import {
  listRemoteDirectories,
  pickWorkspacePaths,
  type RemoteDirectoryEntry,
} from "@services/tauri";
import { pushErrorToast } from "@services/toasts";
import type { AddWorkspacesFromPathsResult } from "@/features/workspaces/hooks/useWorkspaceCrud";
import { mapRemoteDirectoryError } from "@/features/workspaces/utils/remoteDirectoryErrors";

const REMOTE_DIRECTORY_PAGE_SIZE = 300;

const RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY = "mobile-remote-workspace-recent-paths";
const RECENT_REMOTE_WORKSPACE_PATHS_LIMIT = 5;

function parseWorkspacePathInput(value: string) {
  const stripWrappingQuotes = (entry: string) => {
    const trimmed = entry.trim();
    if (trimmed.length < 2) {
      return trimmed;
    }
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" || first === '"') && first === last) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  };

  return value
    .split(/\r?\n|,|;/)
    .map((entry) => stripWrappingQuotes(entry))
    .filter(Boolean);
}

function appendPathIfMissing(value: string, path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return value;
  }
  const entries = parseWorkspacePathInput(value);
  if (entries.includes(trimmedPath)) {
    return value;
  }
  return [...entries, trimmedPath].join("\n");
}

function loadRecentRemoteWorkspacePaths(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, RECENT_REMOTE_WORKSPACE_PATHS_LIMIT);
  } catch {
    return [];
  }
}

function persistRecentRemoteWorkspacePaths(paths: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    RECENT_REMOTE_WORKSPACE_PATHS_STORAGE_KEY,
    JSON.stringify(paths),
  );
}

function mergeRecentRemoteWorkspacePaths(current: string[], nextPaths: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  const push = (entry: string) => {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    merged.push(trimmed);
  };
  nextPaths.forEach(push);
  current.forEach(push);
  return merged.slice(0, RECENT_REMOTE_WORKSPACE_PATHS_LIMIT);
}

type MobileRemoteWorkspacePathPromptState = {
  value: string;
  error: string | null;
  recentPaths: string[];
} | null;

function appendWorkspacePathInput(value: string, path: string) {
  const existing = parseWorkspacePathInput(value);
  if (existing.includes(path)) {
    return value;
  }
  if (existing.length === 0) {
    return path;
  }
  return `${existing.join("\n")}\n${path}`;
}

type WorkspacePathsBrowserState = {
  currentPath: string;
  parentPath: string | null;
  entries: RemoteDirectoryEntry[];
  includeHidden: boolean;
  isLoading: boolean;
  loadError: string | null;
  truncated: boolean;
  entryCount: number;
};

export type WorkspacePathsPromptState = {
  value: string;
  error: string | null;
  browser: WorkspacePathsBrowserState | null;
} | null;

export function useWorkspaceDialogs() {
  const [_recentMobileRemoteWorkspacePaths, setRecentMobileRemoteWorkspacePaths] = useState<
    string[]
  >(() => loadRecentRemoteWorkspacePaths());
  const [mobileRemoteWorkspacePathPrompt, setMobileRemoteWorkspacePathPrompt] =
    useState<MobileRemoteWorkspacePathPromptState>(null);
  const mobileRemoteWorkspacePathResolveRef = useRef<((paths: string[]) => void) | null>(
    null,
  );

  const resolveMobileRemoteWorkspacePathRequest = useCallback((paths: string[]) => {
    const resolve = mobileRemoteWorkspacePathResolveRef.current;
    mobileRemoteWorkspacePathResolveRef.current = null;
    if (resolve) {
      resolve(paths);
    }
  }, []);

  const updateMobileRemoteWorkspacePathInput = useCallback((value: string) => {
    setMobileRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            value,
            error: null,
          }
        : prev,
    );
  }, []);

  const cancelMobileRemoteWorkspacePathPrompt = useCallback(() => {
    setMobileRemoteWorkspacePathPrompt(null);
    resolveMobileRemoteWorkspacePathRequest([]);
  }, [resolveMobileRemoteWorkspacePathRequest]);

  const appendMobileRemoteWorkspacePathFromRecent = useCallback((path: string) => {
    setMobileRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            value: appendPathIfMissing(prev.value, path),
            error: null,
          }
        : prev,
    );
  }, []);

  const rememberRecentMobileRemoteWorkspacePaths = useCallback((paths: string[]) => {
    setRecentMobileRemoteWorkspacePaths((prev) => {
      const next = mergeRecentRemoteWorkspacePaths(prev, paths);
      persistRecentRemoteWorkspacePaths(next);
      return next;
    });
    setMobileRemoteWorkspacePathPrompt((prev) =>
      prev
        ? {
            ...prev,
            recentPaths: mergeRecentRemoteWorkspacePaths(prev.recentPaths, paths),
          }
        : prev,
    );
  }, []);

  const submitMobileRemoteWorkspacePathPrompt = useCallback(() => {
    if (!mobileRemoteWorkspacePathPrompt) {
      return;
    }
    const paths = parseWorkspacePathInput(mobileRemoteWorkspacePathPrompt.value);
    if (paths.length === 0) {
      setMobileRemoteWorkspacePathPrompt((prev) =>
        prev
          ? {
              ...prev,
              error: "Enter at least one absolute directory path.",
            }
          : prev,
      );
      return;
    }
    setMobileRemoteWorkspacePathPrompt(null);
    resolveMobileRemoteWorkspacePathRequest(paths);
  }, [mobileRemoteWorkspacePathPrompt, resolveMobileRemoteWorkspacePathRequest]);

  useEffect(() => {
    return () => {
      resolveMobileRemoteWorkspacePathRequest([]);
    };
  }, [resolveMobileRemoteWorkspacePathRequest]);

  const [workspacePathsPrompt, setWorkspacePathsPrompt] =
    useState<WorkspacePathsPromptState>(null);
  const workspacePathsPromptRef = useRef<WorkspacePathsPromptState>(null);
  const workspacePathsPromptResolveRef = useRef<((paths: string[]) => void) | null>(
    null,
  );
  const workspacePathsBrowserRequestIdRef = useRef(0);

  const resolveWorkspacePathsPrompt = useCallback((paths: string[]) => {
    const resolve = workspacePathsPromptResolveRef.current;
    workspacePathsPromptResolveRef.current = null;
    workspacePathsPromptRef.current = null;
    workspacePathsBrowserRequestIdRef.current += 1;
    setWorkspacePathsPrompt(null);
    resolve?.(paths);
  }, []);

  useEffect(() => {
    workspacePathsPromptRef.current = workspacePathsPrompt;
  }, [workspacePathsPrompt]);

  useEffect(() => {
    return () => {
      workspacePathsBrowserRequestIdRef.current += 1;
      const resolve = workspacePathsPromptResolveRef.current;
      workspacePathsPromptResolveRef.current = null;
      resolve?.([]);
    };
  }, []);

  const refreshWorkspacePathsBrowser = useCallback(
    async (path: string | null, includeHiddenOverride?: boolean) => {
      const currentPrompt = workspacePathsPromptRef.current;
      if (!currentPrompt?.browser) {
        return;
      }

      const includeHidden = includeHiddenOverride ?? currentPrompt.browser.includeHidden;
      const requestId = workspacePathsBrowserRequestIdRef.current + 1;
      workspacePathsBrowserRequestIdRef.current = requestId;

      const loadingPrompt = {
        ...currentPrompt,
        browser: {
          ...currentPrompt.browser,
          includeHidden,
          isLoading: true,
          loadError: null,
        },
      };
      workspacePathsPromptRef.current = loadingPrompt;
      setWorkspacePathsPrompt(loadingPrompt);

      try {
        const response = await listRemoteDirectories({
          path,
          includeHidden,
          limit: REMOTE_DIRECTORY_PAGE_SIZE,
          offset: 0,
        });

        if (workspacePathsBrowserRequestIdRef.current !== requestId) {
          return;
        }

        const latestPrompt = workspacePathsPromptRef.current;
        if (!latestPrompt?.browser) {
          return;
        }

        const nextPrompt = {
          ...latestPrompt,
          browser: {
            currentPath: response.currentPath,
            parentPath: response.parentPath,
            entries: response.entries,
            includeHidden,
            isLoading: false,
            loadError: null,
            truncated: response.truncated,
            entryCount: response.entryCount,
          },
        };
        workspacePathsPromptRef.current = nextPrompt;
        setWorkspacePathsPrompt(nextPrompt);
      } catch (error) {
        if (workspacePathsBrowserRequestIdRef.current !== requestId) {
          return;
        }

        const latestPrompt = workspacePathsPromptRef.current;
        if (!latestPrompt?.browser) {
          return;
        }

        const message = mapRemoteDirectoryError(
          error instanceof Error ? error.message : String(error),
        );
        const nextPrompt = {
          ...latestPrompt,
          browser: {
            ...latestPrompt.browser,
            includeHidden,
            isLoading: false,
            loadError: message,
          },
        };
        workspacePathsPromptRef.current = nextPrompt;
        setWorkspacePathsPrompt(nextPrompt);
      }
    },
    [],
  );

  const requestWorkspacePaths = useCallback(
    async (backendMode?: string) => {
      if (isMobilePlatform() && backendMode === "remote") {
        return new Promise<string[]>((resolve) => {
          if (workspacePathsPromptResolveRef.current) {
            pushErrorToast({
              title: "Add workspaces",
              message: "The workspace path dialog is already open.",
            });
            resolve([]);
            return;
          }

          workspacePathsPromptResolveRef.current = resolve;
          const nextPrompt = {
            value: "",
            error: null,
            browser: {
              currentPath: "",
              parentPath: null,
              entries: [],
              includeHidden: false,
              isLoading: true,
              loadError: null,
              truncated: false,
              entryCount: 0,
            },
          };
          workspacePathsPromptRef.current = nextPrompt;
          setWorkspacePathsPrompt(nextPrompt);
          void refreshWorkspacePathsBrowser(null, false);
        });
      }

      return pickWorkspacePaths();
    },
    [refreshWorkspacePathsBrowser],
  );

  const updateWorkspacePathsPromptValue = useCallback((value: string) => {
    const current = workspacePathsPromptRef.current;
    if (!current) {
      return;
    }
    const next = {
      ...current,
      value,
      error: null,
    };
    workspacePathsPromptRef.current = next;
    setWorkspacePathsPrompt(next);
  }, []);

  const browseWorkspacePathsPromptDirectory = useCallback(
    (path: string) => {
      void refreshWorkspacePathsBrowser(path);
    },
    [refreshWorkspacePathsBrowser],
  );

  const browseWorkspacePathsPromptParentDirectory = useCallback(() => {
    const current = workspacePathsPromptRef.current;
    if (!current?.browser?.parentPath) {
      return;
    }
    void refreshWorkspacePathsBrowser(current.browser.parentPath);
  }, [refreshWorkspacePathsBrowser]);

  const browseWorkspacePathsPromptHomeDirectory = useCallback(() => {
    void refreshWorkspacePathsBrowser(null);
  }, [refreshWorkspacePathsBrowser]);

  const retryWorkspacePathsPromptDirectoryListing = useCallback(() => {
    const current = workspacePathsPromptRef.current;
    if (!current?.browser) {
      return;
    }
    const path = current.browser.currentPath || null;
    void refreshWorkspacePathsBrowser(path);
  }, [refreshWorkspacePathsBrowser]);

  const toggleWorkspacePathsPromptHiddenDirectories = useCallback(() => {
    const current = workspacePathsPromptRef.current;
    if (!current?.browser) {
      return;
    }
    const includeHidden = !current.browser.includeHidden;
    const path = current.browser.currentPath || null;
    void refreshWorkspacePathsBrowser(path, includeHidden);
  }, [refreshWorkspacePathsBrowser]);

  const useWorkspacePathsPromptCurrentDirectory = useCallback(() => {
    const current = workspacePathsPromptRef.current;
    if (!current?.browser || !current.browser.currentPath) {
      return;
    }

    const next = {
      ...current,
      value: appendWorkspacePathInput(current.value, current.browser.currentPath),
      error: null,
    };
    workspacePathsPromptRef.current = next;
    setWorkspacePathsPrompt(next);
  }, []);

  const cancelWorkspacePathsPrompt = useCallback(() => {
    resolveWorkspacePathsPrompt([]);
  }, [resolveWorkspacePathsPrompt]);

  const confirmWorkspacePathsPrompt = useCallback(() => {
    const currentPrompt = workspacePathsPromptRef.current;
    if (!currentPrompt) {
      return;
    }
    const paths = parseWorkspacePathInput(currentPrompt.value);
    if (paths.length === 0) {
      const next = {
        ...currentPrompt,
        error: "Enter at least one absolute path.",
      };
      workspacePathsPromptRef.current = next;
      setWorkspacePathsPrompt(next);
      return;
    }
    const invalidPaths = paths.filter((path) => !isAbsolutePath(path));
    if (invalidPaths.length > 0) {
      const next = {
        ...currentPrompt,
        error: "Use absolute paths only.",
      };
      workspacePathsPromptRef.current = next;
      setWorkspacePathsPrompt(next);
      return;
    }
    resolveWorkspacePathsPrompt(paths);
  }, [resolveWorkspacePathsPrompt]);

  const showAddWorkspacesResult = useCallback(
    async (result: AddWorkspacesFromPathsResult) => {
      const hasIssues =
        result.skippedExisting.length > 0 ||
        result.skippedInvalid.length > 0 ||
        result.failures.length > 0;
      if (!hasIssues) {
        return;
      }

      const lines: string[] = [];
      lines.push(
        `Added ${result.added.length} workspace${result.added.length === 1 ? "" : "s"}.`,
      );
      if (result.skippedExisting.length > 0) {
        lines.push(
          `Skipped ${result.skippedExisting.length} already added workspace${
            result.skippedExisting.length === 1 ? "" : "s"
          }.`,
        );
      }
      if (result.skippedInvalid.length > 0) {
        lines.push(
          `Skipped ${result.skippedInvalid.length} invalid path${
            result.skippedInvalid.length === 1 ? "" : "s"
          } (not a folder).`,
        );
      }
      if (result.failures.length > 0) {
        lines.push(
          `Failed to add ${result.failures.length} workspace${
            result.failures.length === 1 ? "" : "s"
          }.`,
        );
        const details = result.failures
          .slice(0, 3)
          .map(({ path, message: failureMessage }) => `- ${path}: ${failureMessage}`);
        if (result.failures.length > 3) {
          details.push(`- …and ${result.failures.length - 3} more`);
        }
        lines.push("");
        lines.push("Failures:");
        lines.push(...details);
      }

      const title =
        result.failures.length > 0
          ? "Some workspaces failed to add"
          : "Some workspaces were skipped";
      const summary = lines.join("\n");

      if (isMobilePlatform()) {
        pushErrorToast({ title, message: summary });
        return;
      }

      try {
        await message(summary, {
          title,
          kind: result.failures.length > 0 ? "error" : "warning",
        });
      } catch {
        pushErrorToast({ title, message: summary });
      }
    },
    [],
  );

  const confirmWorkspaceRemoval = useCallback(
    async (workspaces: WorkspaceInfo[], workspaceId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const workspaceName = workspace?.name || "this workspace";
      const worktreeCount = workspaces.filter(
        (entry) => entry.parentId === workspaceId,
      ).length;
      const detail =
        worktreeCount > 0
          ? `\n\nThis will also delete ${worktreeCount} worktree${
              worktreeCount === 1 ? "" : "s"
            } on disk.`
          : "";

      return ask(
        `Are you sure you want to delete "${workspaceName}"?\n\nThis will remove the workspace from CodexMonitor.${detail}`,
        {
          title: "Delete Workspace",
          kind: "warning",
          okLabel: "Delete",
          cancelLabel: "Cancel",
        },
      );
    },
    [],
  );

  const confirmWorktreeRemoval = useCallback(
    async (workspaces: WorkspaceInfo[], workspaceId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      const workspaceName = workspace?.name || "this worktree";
      return ask(
        `Are you sure you want to delete "${workspaceName}"?\n\nThis will close the agent, remove its worktree, and delete it from CodexMonitor.`,
        {
          title: "Delete Worktree",
          kind: "warning",
          okLabel: "Delete",
          cancelLabel: "Cancel",
        },
      );
    },
    [],
  );

  const showWorkspaceRemovalError = useCallback(async (errorMessage: string) => {
    await message(errorMessage, {
      title: "Delete workspace failed",
      kind: "error",
    });
  }, []);

  const showWorktreeRemovalError = useCallback(async (errorMessage: string) => {
    await message(errorMessage, {
      title: "Delete worktree failed",
      kind: "error",
    });
  }, []);

  return {
    requestWorkspacePaths,
    mobileRemoteWorkspacePathPrompt,
    updateMobileRemoteWorkspacePathInput,
    cancelMobileRemoteWorkspacePathPrompt,
    submitMobileRemoteWorkspacePathPrompt,
    appendMobileRemoteWorkspacePathFromRecent,
    rememberRecentMobileRemoteWorkspacePaths,
    workspacePathsPrompt,
    updateWorkspacePathsPromptValue,
    browseWorkspacePathsPromptDirectory,
    browseWorkspacePathsPromptParentDirectory,
    browseWorkspacePathsPromptHomeDirectory,
    retryWorkspacePathsPromptDirectoryListing,
    toggleWorkspacePathsPromptHiddenDirectories,
    useWorkspacePathsPromptCurrentDirectory,
    cancelWorkspacePathsPrompt,
    confirmWorkspacePathsPrompt,
    showAddWorkspacesResult,
    confirmWorkspaceRemoval,
    confirmWorktreeRemoval,
    showWorkspaceRemovalError,
    showWorktreeRemovalError,
  };
}
