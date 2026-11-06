import type { FeedbackNote, FeedbackNoteDraft } from './core/feedbackNotes';

declare global {
  interface PixelEditorDesktop {
    saveFile(request: {
      suggestedName: string;
      mimeType: string;
      data: Uint8Array;
    }): Promise<'saved' | 'cancelled'>;
    listFeedbackNotes(): Promise<FeedbackNote[]>;
    createFeedbackNote(draft: FeedbackNoteDraft): Promise<FeedbackNote>;
    updateFeedbackNote(number: number, draft: FeedbackNoteDraft): Promise<FeedbackNote>;
  }

  interface Window {
    pixelEditorDesktop?: PixelEditorDesktop;
  }
}

export {};
