"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

function clampPercent(value: number, minimum = 10): number {
  if (!Number.isFinite(value)) return 80;
  return Math.min(100, Math.max(minimum, Math.round(value)));
}

export function FigureResizePreview({
  preview,
  alt,
  width,
  disabled,
  isPdf,
  onWidthChange,
  minimumPercent = 10,
}: {
  preview: string | null;
  alt: string;
  width: number;
  disabled?: boolean;
  isPdf?: boolean;
  onWidthChange: (width: number) => void;
  minimumPercent?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const percent = clampPercent(width * 100, minimumPercent);
  const onWidthRef = useRef(onWidthChange);
  onWidthRef.current = onWidthChange;

  const releaseCapture = useCallback(() => {
    const handle = handleRef.current;
    const drag = dragRef.current;
    if (!handle || !drag) return;
    try {
      if (handle.hasPointerCapture?.(drag.pointerId))
        handle.releasePointerCapture(drag.pointerId);
    } catch {
      /* capture unavailable (e.g. synthetic events in tests) */
    }
  }, []);

  const cancelDrag = useCallback(() => {
    releaseCapture();
    dragRef.current = null;
    setDragging(false);
  }, [releaseCapture]);

  useEffect(() => {
    return () => {
      dragRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (disabled) cancelDrag();
  }, [disabled, cancelDrag]);

  function widthFromClientX(clientX: number) {
    const track = trackRef.current;
    const trackWidth = track?.clientWidth || 260;
    const left = track?.getBoundingClientRect().left ?? 0;
    onWidthRef.current(
      clampPercent(((clientX - left) / trackWidth) * 100, minimumPercent) / 100,
    );
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    cancelDrag();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture unavailable (e.g. synthetic events in tests) */
    }
    dragRef.current = { pointerId: event.pointerId };
    setDragging(true);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || !dragRef.current) return;
    widthFromClientX(event.clientX);
  }

  function handleKey(event: React.KeyboardEvent) {
    if (disabled) return;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown")
      next = percent - (event.shiftKey ? 10 : 1);
    else if (event.key === "ArrowRight" || event.key === "ArrowUp")
      next = percent + (event.shiftKey ? 10 : 1);
    else if (event.key === "Home") next = minimumPercent;
    else if (event.key === "End") next = 100;
    if (next !== null) {
      event.preventDefault();
      onWidthChange(clampPercent(next, minimumPercent) / 100);
    }
  }

  return (
    <div
      data-testid="figure-resize-preview"
      className="relative flex min-h-36 items-center justify-start overflow-hidden rounded border border-border bg-muted/30 p-3"
    >
      <div ref={trackRef} className="relative w-full">
        <div
          className="relative"
          style={{ width: `${percent}%`, maxWidth: "100%" }}
        >
          {preview ? (
            <Image
              unoptimized
              src={preview}
              alt={alt}
              width={600}
              height={400}
              className="max-h-56 w-full max-w-full object-contain"
            />
          ) : (
            <p className="break-all text-xs text-muted-foreground">
              {isPdf
                ? "PDF figure · use Proof to view its rendered page"
                : "Choose or upload a project image."}
            </p>
          )}
          <div
            ref={handleRef}
            role="slider"
            aria-label="Drag to resize figure width"
            aria-valuemin={minimumPercent}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}% of text width`}
            aria-disabled={disabled ? "true" : undefined}
            tabIndex={disabled ? -1 : 0}
            data-testid="figure-resize-handle"
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={cancelDrag}
            onPointerCancel={cancelDrag}
            onKeyDown={handleKey}
            className={`absolute inset-y-1 right-1 flex w-6 cursor-ew-resize items-center justify-center rounded border border-border bg-background/90 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              disabled
                ? "cursor-not-allowed opacity-40"
                : dragging
                  ? "bg-muted"
                  : "hover:bg-muted"
            }`}
            style={{ touchAction: "none" }}
          >
            <span aria-hidden="true">↔</span>
          </div>
        </div>
      </div>
      <span className="pointer-events-none absolute bottom-1 left-2 text-[11px] text-muted-foreground">
        {percent}%{dragging ? " · dragging" : ""}
      </span>
    </div>
  );
}

export function clampFigureWidthPercent(value: number): number {
  return clampPercent(value);
}
