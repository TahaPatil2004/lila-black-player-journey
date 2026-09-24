// src/hooks/useZoomPan.ts
// Absolute zoom and pan state manager.
// Computes and enforces bounds based on image and canvas dimensions.

import { useCallback, useRef, useState, useEffect, type RefObject } from 'react';
import type { Viewport } from '../renderer/mapRenderer';

interface UseZoomPanResult {
  viewport: Viewport;
  resetViewport: () => void;
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
}

export function useZoomPan(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  contentWidth: number,
  contentHeight: number
): UseZoomPanResult {
  
  // Calculate the base fit
  const fitScale = (contentWidth > 0 && canvasWidth > 0)
    ? Math.min(canvasWidth / contentWidth, canvasHeight / contentHeight)
    : 1;
    
  const maxScale = fitScale * 5.0;

  // Helper to strictly clamp viewport constraints
  const constrain = useCallback((vp: Viewport) => {
    if (contentWidth === 0 || canvasWidth === 0) return vp;

    const scale = Math.max(fitScale, Math.min(maxScale, vp.scale));
    
    const currentW = contentWidth * scale;
    const currentH = contentHeight * scale;

    let x = vp.offsetX;
    let y = vp.offsetY;

    // Constrain X
    if (currentW <= canvasWidth) {
      x = (canvasWidth - currentW) / 2; // lock to center
    } else {
      x = Math.max(canvasWidth - currentW, Math.min(0, x)); // clamp to edges
    }

    // Constrain Y
    if (currentH <= canvasHeight) {
      y = (canvasHeight - currentH) / 2; // lock to center
    } else {
      y = Math.max(canvasHeight - currentH, Math.min(0, y)); // clamp to edges
    }

    return { scale, offsetX: x, offsetY: y };
  }, [canvasWidth, canvasHeight, contentWidth, contentHeight, fitScale, maxScale]);

  const [viewport, setViewport] = useState<Viewport>({ offsetX: 0, offsetY: 0, scale: 1 });

  // Whenever dimensions change (window resize or map switch), ensure viewport remains valid
  useEffect(() => {
    setViewport(vp => {
      // If we are at default state (scale 1) and just loaded a map, reset to fitScale.
      // Otherwise, just constrain the current view.
      if (vp.scale === 1 && vp.offsetX === 0 && vp.offsetY === 0 && contentWidth > 0) {
        return constrain({ scale: fitScale, offsetX: 0, offsetY: 0 });
      }
      return constrain(vp);
    });
  }, [constrain, fitScale, contentWidth]);

  // Explicit reset button handler
  const resetViewport = useCallback(() => {
    setViewport(constrain({ scale: fitScale, offsetX: 0, offsetY: 0 }));
  }, [constrain, fitScale]);

  // Pan state refs
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Natively handle wheel to prevent scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || contentWidth === 0) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      setViewport((vp) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Zoom step multiplier
        const zoomFactor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
        let newScale = vp.scale * zoomFactor;
        
        // Pre-clamp scale for offset math
        newScale = Math.max(fitScale, Math.min(maxScale, newScale));
        const scaleRatio = newScale / vp.scale;

        // Zoom toward cursor
        const newOffsetX = mouseX - scaleRatio * (mouseX - vp.offsetX);
        const newOffsetY = mouseY - scaleRatio * (mouseY - vp.offsetY);

        return constrain({ scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY });
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [canvasRef, constrain, fitScale, maxScale, contentWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setViewport((vp) => constrain({
      scale: vp.scale,
      offsetX: vp.offsetX + dx,
      offsetY: vp.offsetY + dy,
    }));
  }, [constrain]);

  const stopPanning = useCallback(() => {
    isPanning.current = false;
  }, []);

  return {
    viewport,
    resetViewport,
    onMouseDown,
    onMouseMove,
    onMouseUp: stopPanning,
    onMouseLeave: stopPanning,
  };
}
