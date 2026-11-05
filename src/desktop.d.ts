interface PixelEditorDesktop {
  saveFile(request: {
    suggestedName: string;
    mimeType: string;
    data: Uint8Array;
  }): Promise<'saved' | 'cancelled'>;
}

interface Window {
  pixelEditorDesktop?: PixelEditorDesktop;
}
