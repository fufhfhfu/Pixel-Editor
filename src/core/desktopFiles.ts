export async function saveDesktopBlobWithFileName(blob: Blob, suggestedName: string): Promise<DesktopSaveResult> {
  const desktop = window.pixelEditorDesktop;
  if (!desktop) throw new Error('Pixel Editor доступен только в настольном приложении.');

  return desktop.saveFile({
    suggestedName,
    mimeType: blob.type,
    data: new Uint8Array(await blob.arrayBuffer()),
  });
}

export async function saveDesktopProject(
  blob: Blob,
  suggestedName: string,
  handle: string | null,
  forceDialog: boolean,
): Promise<DesktopProjectSaveResult> {
  const desktop = window.pixelEditorDesktop;
  if (!desktop) throw new Error('Pixel Editor доступен только в настольном приложении.');

  return desktop.saveProjectFile({
    suggestedName,
    data: new Uint8Array(await blob.arrayBuffer()),
    handle,
    forceDialog,
  });
}

export async function saveDesktopBlob(blob: Blob, suggestedName: string): Promise<'saved' | 'cancelled'> {
  const result = await saveDesktopBlobWithFileName(blob, suggestedName);
  return result.status;
}
