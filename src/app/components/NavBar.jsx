// src/app/components/NavBar.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Mail, Plus, Search, Menu } from "lucide-react";

export default function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const isActive = (href) =>
    pathname === href || pathname?.startsWith(href + "/");
  const linkBase = "text-sm px-2 py-1.5 rounded-md transition-colors";
  const linkInactive = "text-white/70 hover:text-white hover:bg-white/10";
  const linkActive = "text-white bg-white/10";

  const NavLinks = () => (
    <>
      <Link href="/dashboard" className={`${linkBase} ${isActive("/dashboard") ? linkActive : linkInactive}`}>Dashboard</Link>
      <Link href="/contacts" className={`${linkBase} ${isActive("/contacts") ? linkActive : linkInactive}`}>Contacts</Link>
      <Link href="/sequences" className={`${linkBase} ${isActive("/sequences") ? linkActive : linkInactive}`}>Sequences</Link>
      <Link href="/companies" className={`${linkBase} ${isActive("/companies") ? linkActive : linkInactive}`}>Companies</Link>
      <Link href="/marketing" className={`${linkBase} ${isActive("/marketing") ? linkActive : linkInactive}`}>Marketing</Link>
      <Link href="/news" className={`${linkBase} ${isActive("/news") ? linkActive : linkInactive}`}>News</Link>
      
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black shadow-sm">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-white/60">
              Glassbox Outreach
            </p>
            <h1 className="-mt-0.5 text-lg font-semibold text-white">
              Dashboard
            </h1>
          </div>
        </div>

        <nav className="hidden items-center gap-2 md:flex">
          <NavLinks />
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-72 rounded-lg border border-white/10 bg-black py-2 pl-10 pr-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
              placeholder="Search contacts…"
            />
          </div>
          <Link
            href="/contacts"
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-3 py-2 text-sm font-medium text-white hover:bg-white/10"
          >
            <Plus className="h-4 w-4" /> New
          </Link>
        </div>

        <button
          className="rounded-md border border-white/10 p-2 text-white md:hidden"
          onClick={() => setOpen((s) => !s)}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-black md:hidden">
          <div className="mx-auto max-w-7xl space-y-3 px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black py-2 pl-10 pr-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/30"
                placeholder="Search contacts…"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <NavLinks />
            </div>
            <Link
              href="/contacts"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-3 py-2 text-sm font-medium text-white hover:bg-white/10"
            >
              <Plus className="h-4 w-4" />
              New
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
