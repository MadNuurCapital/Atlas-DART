"use client";

import { useEffect } from "react";

/**
 * The last resort: an error in the root layout itself, before any of the
 * app's own styling exists. It has to render its own <html> and <body>, and it
 * cannot rely on Tailwind having loaded, so the styles here are inline on
 * purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] fatal error", error.digest, error.message);
  }, [error]);

  return (
    <html lang="en-SG">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "1.5rem",
          background: "#eef3f8",
          color: "#0d1b26",
        }}
      >
        <div style={{ maxWidth: "24rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>
            Atlas DART could not start
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280" }}>
            Something went wrong before the app could load. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem 1.25rem",
              fontSize: "1rem",
              color: "#ffffff",
              background: "#0b5a92",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: "1rem",
                fontSize: "0.75rem",
                color: "#9ca3af",
              }}
            >
              Reference {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
