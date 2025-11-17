'use client';

import { useState } from 'react';
import FilmDetailsModal from './FilmDetailsModal';
import UploadModal from './UploadModal';
import UploadModalLong from './UploadModalLong';
import type { FilmMetadata } from '@/types';

interface TwoStepUploadModalProps {
  onClose: () => void;
  onUploadComplete: () => void;
  userId: string;
  isLongVideo?: boolean; // true для длинного видео
}

export default function TwoStepUploadModal({
  onClose,
  onUploadComplete,
  userId,
  isLongVideo = false,
}: TwoStepUploadModalProps) {
  const [step, setStep] = useState<'details' | 'upload'>('details');
  const [filmMetadata, setFilmMetadata] = useState<FilmMetadata | null>(null);

  const handleContinueWithDetails = (metadata: FilmMetadata) => {
    setFilmMetadata(metadata);
    setStep('upload');
  };

  const handleSkipDetails = () => {
    setFilmMetadata(null);
    setStep('upload');
  };

  if (step === 'details') {
    return (
      <FilmDetailsModal
        onClose={onClose}
        onContinue={handleContinueWithDetails}
        onSkip={handleSkipDetails}
      />
    );
  }

  // Если длинное видео - показываем UploadModalLong, иначе обычный UploadModal
  if (isLongVideo) {
    return (
      <UploadModalLong
        onClose={onClose}
        onUploadComplete={onUploadComplete}
        userId={userId}
        filmMetadata={filmMetadata}
      />
    );
  }

  return (
    <UploadModal
      onClose={onClose}
      onUploadComplete={onUploadComplete}
      userId={userId}
      filmMetadata={filmMetadata}
    />
  );
}

