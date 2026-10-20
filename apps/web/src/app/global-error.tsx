"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Root failure recovery uses a full navigation without a working router. */

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "48px 24px",
  backgroundColor: "#fdfcff",
  color: "#09090b",
  fontFamily: "system-ui, -apple-system, sans-serif",
  textAlign: "center",
};

const cardStyle: React.CSSProperties = {
  maxWidth: "560px",
  width: "100%",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: "#64748b",
};

const titleStyle: React.CSSProperties = {
  marginTop: "12px",
  fontSize: "32px",
  fontWeight: 700,
  letterSpacing: "-0.02em",
};

const textStyle: React.CSSProperties = {
  marginTop: "12px",
  fontSize: "14px",
  lineHeight: 1.6,
  color: "#64748b",
};

const rowStyle: React.CSSProperties = {
  marginTop: "32px",
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  justifyContent: "center",
};

const primaryStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "16px",
  backgroundColor: "#7c3aed",
  color: "#ffffff",
  padding: "12px 24px",
  fontSize: "13px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  border: "none",
  cursor: "pointer",
  textDecoration: "none",
};

const secondaryStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "16px",
  backgroundColor: "#ffffff",
  color: "#09090b",
  padding: "12px 24px",
  fontSize: "13px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  border: "1px solid #e8e6f2",
  cursor: "pointer",
  textDecoration: "none",
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <main style={pageStyle}>
          <div style={cardStyle}>
            <p style={eyebrowStyle}>Something went wrong</p>
            <h1 style={titleStyle}>The app failed to load</h1>
            <p style={textStyle}>
              The page stopped after an error. Retry, or go home and continue
              from there.
            </p>
            <div style={rowStyle}>
              <button type="button" onClick={reset} style={primaryStyle}>
                Try again
              </button>
              <a href="/" style={secondaryStyle}>
                Go home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
