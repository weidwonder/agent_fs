import { useRef, useState } from 'react';

interface FileUploadProps {
  onUpload: (files: File[]) => Promise<void>;
  disabled?: boolean;
}

export function FileUpload({ onUpload, disabled }: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    setUploading(true);
    try {
      await onUpload(files);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    await handleFiles(files);
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    await handleFiles(files);
    if (inputRef.current) inputRef.current.value = '';
  };

  const isDisabled = disabled || uploading;

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); if (!isDisabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => !isDisabled && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
        dragging
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-300 hover:border-gray-400 bg-white'
      } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleChange}
        className="hidden"
        disabled={isDisabled}
      />
      <p className="text-sm text-gray-500">
        {uploading
          ? 'Uploading...'
          : 'Drag & drop files here, or click to select'}
      </p>
      <p className="text-xs text-gray-400 mt-1">
        PDF, DOCX, XLSX, Markdown supported
      </p>
    </div>
  );
}
