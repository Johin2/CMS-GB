// src/app/components/Card.jsx
import React from "react";

export default function Card({ title, children, action }) {
  return (
    <div className="rounded-2xl border border-white/10 p-4 shadow-sm bg-black text-white">
      {title ? (
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium">{title}</div>
          {action || null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
