"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  /**
   * Element to receive focus when the dialog closes. Defaults to Radix's
   * focus return when omitted.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  onCloseAutoFocus?: (event: Event) => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Accept",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
  children,
  returnFocusRef,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => (!next ? onCancel() : undefined)}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[100] w-[min(460px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background text-foreground shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
          onCloseAutoFocus={(event) => {
            if (returnFocusRef?.current) {
              event.preventDefault();
              returnFocusRef.current.focus();
            }
            onCloseAutoFocus?.(event);
          }}
        >
          <div className="flex items-start justify-between border-b p-4">
            <div>
              <Dialog.Title className="text-sm font-semibold">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </Dialog.Close>
          </div>
          {children ? <div className="p-4">{children}</div> : null}
          <div className="flex items-center justify-end gap-2 border-t p-4">
            <button
              onClick={onCancel}
              className="h-9 rounded-md border px-3 text-sm text-foreground hover:bg-muted"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={cn(
                "h-9 rounded-md px-3 text-sm text-primary-foreground",
                danger
                  ? "bg-destructive hover:bg-destructive/90"
                  : "bg-primary hover:bg-primary/90",
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
