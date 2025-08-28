// src/app/components/StatCard.tsx
import React from "react";
import { motion } from "framer-motion";

export default function StatCard({ title, value, Icon, hint }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black p-5 text-white shadow-sm hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-white/60">{title}</p>
          <p className="mt-2 text-4xl font-semibold tracking-tight">{value}</p>
        </div>
        <div className="rounded-xl bg-white/10 p-3 text-white group-hover:bg-white/20">
          {Icon ? <Icon className="h-6 w-6" /> : null}
        </div>
      </div>
      {hint && <p className="mt-3 text-xs text-white/60">{hint}</p>}
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5 opacity-0 transition group-hover:opacity-100" />
    </motion.div>
  );
}
