// src/hooks/useMinimapImage.ts
// Loads a minimap image by filename and returns an HTMLImageElement.
// Caches by filename so switching maps doesn't reload the same image.

import { useEffect, useState } from 'react';

interface UseMinimapImageResult {
  image: HTMLImageElement | null;
  loading: boolean;
  error: string | null;
  /** Actual pixel dimensions of the loaded image */
  naturalWidth: number;
  naturalHeight: number;
}

const imageCache = new Map<string, HTMLImageElement>();

export function useMinimapImage(filename: string | null): UseMinimapImageResult {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);

  useEffect(() => {
    if (!filename) {
      setImage(null);
      return;
    }

    // Return cached version immediately
    if (imageCache.has(filename)) {
      const cached = imageCache.get(filename)!;
      setImage(cached);
      setNaturalWidth(cached.naturalWidth);
      setNaturalHeight(cached.naturalHeight);
      return;
    }

    setLoading(true);
    setError(null);

    const img = new Image();
    img.onload = () => {
      imageCache.set(filename, img);
      setImage(img);
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
      setLoading(false);
    };
    img.onerror = () => {
      setError(`Failed to load minimap: ${filename}`);
      setLoading(false);
    };
    img.src = `/minimaps/${filename}`;
  }, [filename]);

  return { image, loading, error, naturalWidth, naturalHeight };
}
