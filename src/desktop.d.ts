interface PixelEditorDesktop {
  saveFile(request: {
    suggestedName: string;
    mimeType: string;
    data: Uint8Array;
  }): Promise<'saved' | 'cancelled'>;
  saveBatch(requests: Array<{ name: string; data: Uint8Array }>): Promise<'saved' | 'cancelled'>;
  exportPdf(request: { title: string; text: string }): Promise<'saved' | 'cancelled'>;
  onCommand(callback: (command: string) => void): () => void;
  setTitle(title: string): Promise<void>;
  setDirty(dirty: boolean): Promise<void>;
  closeApproved(): Promise<void>;
  onOpenFile(callback: (file: { name: string; data: Uint8Array; backupData?: Uint8Array }) => void): () => void;
}

interface Window {
  pixelEditorDesktop?: PixelEditorDesktop;
}
