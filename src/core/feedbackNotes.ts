export const WELCOME_SEEN_KEY = 'pixel-editor:welcome-seen';

export const FEEDBACK_NOTE_CATEGORIES = [
  'Ошибка / баг',
  'Новая функция',
  'Улучшение существующего функционала',
  'Другое',
] as const;

export type FeedbackNoteCategory = (typeof FEEDBACK_NOTE_CATEGORIES)[number];

export interface FeedbackNoteDraft {
  title: string;
  category: FeedbackNoteCategory;
  description: string;
}

export interface FeedbackNote extends FeedbackNoteDraft {
  number: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackNotesBridge {
  listFeedbackNotes(): Promise<FeedbackNote[]>;
  createFeedbackNote(draft: FeedbackNoteDraft): Promise<FeedbackNote>;
  updateFeedbackNote(number: number, draft: FeedbackNoteDraft): Promise<FeedbackNote>;
}
