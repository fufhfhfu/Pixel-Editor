import type { FeedbackNote, FeedbackNoteDraft } from './core/feedbackNotes';

declare global {
  type DesktopSaveResult =
    | { status: 'saved'; fileName: string }
    | { status: 'cancelled' };

  interface DesktopRecentProject {
    id: string;
    fileName: string;
  }

  interface DesktopOpenProjectPayload {
    handle: string;
    fileName: string;
    data: Uint8Array;
  }

  interface DesktopProjectBackup {
    fileName: string;
    data: Uint8Array;
  }

  interface DesktopNotesBackup {
    title: string;
    notes: string;
    createdAt: number;
    updatedAt: number;
  }

  interface DesktopAppInfo {
    version: string;
    updatesSupported: boolean;
  }

  type DesktopUpdateStatus =
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'current'; version: string }
    | { status: 'available'; version: string }
    | { status: 'downloading'; percent: number }
    | { status: 'downloaded'; version: string }
    | { status: 'error'; message: string };

  type DesktopProjectSaveResult =
    | { status: 'saved'; fileName: string; handle: string; recentProjects: DesktopRecentProject[] }
    | { status: 'cancelled' };

  interface PixelEditorDesktop {
    getAppInfo(): Promise<DesktopAppInfo>;
    checkForUpdates(): Promise<void>;
    downloadUpdate(): Promise<void>;
    installUpdate(): Promise<void>;
    onUpdateStatus(callback: (status: DesktopUpdateStatus) => void): () => void;
    saveFile(request: {
      suggestedName: string;
      mimeType: string;
      data: Uint8Array;
    }): Promise<DesktopSaveResult>;
    saveProjectFile(request: {
      suggestedName: string;
      data: Uint8Array;
      handle: string | null;
      forceDialog: boolean;
    }): Promise<DesktopProjectSaveResult>;
    registerSelectedProject(file: File): Promise<{ handle: string; fileName: string }>;
    setCurrentProject(handle: string): Promise<DesktopRecentProject[]>;
    listRecentProjects(): Promise<DesktopRecentProject[]>;
    openRecentProject(id: string): Promise<DesktopOpenProjectPayload>;
    getLatestProjectBackup(handle: string): Promise<DesktopProjectBackup | null>;
    getNotesBackup(): Promise<DesktopNotesBackup | null>;
    exportNotesPdf(request: DesktopNotesBackup): Promise<DesktopSaveResult>;
    takePendingProject(): Promise<DesktopOpenProjectPayload | null>;
    onOpenProject(callback: (project: DesktopOpenProjectPayload) => void): () => void;
    beginBatchExport(): Promise<string | null>;
    writeBatchExport(sessionId: string, fileName: string, data: Uint8Array): Promise<void>;
    endBatchExport(sessionId: string): Promise<void>;
    closeWindowAfterSave(): Promise<void>;
    updateWindowState(state: {
      fileName: string | null;
      dirty: boolean;
      canUndo: boolean;
      canRedo: boolean;
      notesBackup: DesktopNotesBackup;
    }): void;
    onMenuCommand(callback: (command: string) => void): () => void;
    listFeedbackNotes(): Promise<FeedbackNote[]>;
    createFeedbackNote(draft: FeedbackNoteDraft): Promise<FeedbackNote>;
    updateFeedbackNote(number: number, draft: FeedbackNoteDraft): Promise<FeedbackNote>;
  }

  interface Window {
    pixelEditorDesktop?: PixelEditorDesktop;
  }
}

export {};
