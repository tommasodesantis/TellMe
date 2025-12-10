
export enum AppState {
  LANDING,
  CAPTURING, // Processing the file input
  ANALYZING, // Gemini 3 Pro thinking
  GENERATING_ART, // Gemini 3 Pro Image Preview drawing
  READY, // Story displayed
  ERROR
}

export interface VisualPrompts {
  sourcePanel: string;
  subjectPanel: string;
  actionPanel: string;
}

export interface DocumentAnalysis {
  actor: string;
  topic: string;
  action: string;
  isUrgent: boolean; // Determines Green/Red status
  narrative: string; // The script for TTS
  detailedSummary: string; // Detailed context for Live API
  prompts: VisualPrompts;
}

export type ImageResolution = '1K' | '2K' | '4K';

export type Language = 'English' | 'Spanish' | 'French' | 'Hindi' | 'Arabic';
