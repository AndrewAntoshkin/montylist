import React from 'react';

interface GradientBorderProps {
  children: React.ReactNode;
  className?: string;
}

export default function GradientBorder({ children, className = '' }: GradientBorderProps) {
  return (
    <div
      className={`animate-border overflow-hidden rounded-xl border-2 border-transparent bg-gradient-border ${className}`}
      style={{
        background: `
          linear-gradient(#191919, #191919) padding-box,
          conic-gradient(
            from var(--border-angle),
            transparent 80%,
            #a855f7 86%,
            #06b6d4 90%,
            #8b5cf6 94%,
            rgba(168, 85, 247, 0.48)
          ) border-box
        `,
      }}
    >
      {children}
    </div>
  );
}

