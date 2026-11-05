import { useCallback, useId, useRef, useState } from 'react';

export interface DropzoneProps {
  readonly onFile: (file: File) => void;
  readonly disabled?: boolean;
}

const ACCEPTED = 'image/png,image/jpeg,image/webp,image/avif,image/gif';

/**
 * Pulls the first image out of a drop, paste or file-picker payload. The two
 * list types are indexed rather than spread because they have no common
 * iterable type.
 */
function imageFrom(source: DataTransferItemList | FileList | null): File | null {
  if (!source) return null;

  for (let i = 0; i < source.length; i += 1) {
    const entry: DataTransferItem | File | undefined = source[i];
    if (!entry) continue;
    const file = entry instanceof File ? entry : entry.getAsFile();
    if (file?.type.startsWith('image/')) return file;
  }

  return null;
}

/**
 * Accepts an image by drag-and-drop, file picker or paste.
 *
 * It is a real <button> wrapping a hidden file input, so it is reachable and
 * operable by keyboard without re-implementing button semantics.
 */
export function Dropzone({ onFile, disabled = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (disabled) return;
      const file = imageFrom(event.clipboardData.items);
      if (file) {
        event.preventDefault();
        onFile(file);
      }
    },
    [disabled, onFile],
  );

  return (
    <div
      onPaste={handlePaste}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(false);
        const file = imageFrom(event.dataTransfer.items);
        if (file) onFile(file);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
        data-dragging={dragging || undefined}
        className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border-subtle bg-surface-sunken px-6 py-12 text-center transition-colors enabled:hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 data-dragging:border-accent data-dragging:bg-surface-raised"
      >
        <span className="text-sm font-medium">Drop an image, or click to choose</span>
        <span id={hintId} className="text-xs text-ink-muted">
          You can also paste from the clipboard. PNG, JPEG, WebP, AVIF or GIF.
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = imageFrom(event.target.files);
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
