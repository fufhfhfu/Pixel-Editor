export async function saveDesktopBlob(blob: Blob, suggestedName: string): Promise<'saved' | 'cancelled'> {
  const desktop = window.pixelEditorDesktop;
  if (!desktop) throw new Error('Pixel Editor доступен только в настольном приложении.');

  return desktop.saveFile({
    suggestedName,
    mimeType: blob.type,
    data: new Uint8Array(await blob.arrayBuffer()),
  });
}
