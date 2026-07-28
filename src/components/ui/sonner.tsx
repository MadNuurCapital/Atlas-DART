"use client";

import { Toaster as Sonner } from "sonner";

/**
 * Toast host. Positioned top-centre because the bottom of a phone screen is
 * occupied by the fixed navigation, and a toast behind it is a toast nobody
 * reads.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "rounded-lg border border-border text-sm",
        },
      }}
    />
  );
}
