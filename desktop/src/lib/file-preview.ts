export const FILE_PREVIEW_EVENT = 'dorabot:file-preview';

export type PreviewFileType = 'markdown' | 'html' | 'json';

export function supportsFilePreview(fileType: string): fileType is PreviewFileType {
  return fileType === 'markdown' || fileType === 'html' || fileType === 'json';
}
