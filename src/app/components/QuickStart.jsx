"use client";

import { useState } from "react";

const SAMPLE_LEADS = [
  { name: "Alicia Ng",   email: "alicia.ng@globex.com",  phone: "+1 (415) 555-0123", company: "Globex" },
  { name: "Ben Stone",   email: "ben.stone@acme.com",    phone: "+1 (650) 555-0191", company: "Acme" },
  { name: "Carl Diaz",   email: "carl.diaz@initech.io",  phone: "+1 (212) 555-0177", company: "Initech" },
  { name: "Dana Patel",  email: "dana.patel@soylent.co", phone: "+44 20 7946 0202",  company: "Soylent" },
  { name: "Evan Lee",    email: "evan.lee@umbrella.ai",  phone: "+61 2 5550 1000",   company: "Umbrella" },
  { name: "Fiona Chen",  email: "f.chen@tyrell.dev",     phone: "+65 6789 1234",     company: "Tyrell" },
];

export default function SampleLeads() {
  const [saving, setSaving] = useState({}); // {email: boolean}
  const [note, setNote] = useState("");

  async function addToContacts(lead) {
    try {
      setSaving((s) => ({ ...s, [lead.email]: true }));
      // Split name into first/last for the contacts API
      const [firstName = "", ...rest] = lead.name.split(" ");
      const lastName = rest.join(" ");
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: lead.email,
          firstName,
          lastName,
          company: lead.company
          // Phone isn’t stored by default; add it to the schema if you want to persist it.
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to add contact");
      }
      setNote(`Added ${lead.name} to Contacts`);
    } catch (e) {
      setNote(e.message || "Something went wrong.");
    } finally {
      setSaving((s) => ({ ...s, [lead.email]: false }));
    }
  }

  return (
    <div className="rounded-2xl border p-4 shadow-sm bg-black text-white">
      <div className="mb-3 font-medium">Sample leads</div>

      <div className="grid gap-3 sm:grid-cols-2">
        {SAMPLE_LEADS.map((lead) => (
          <div key={lead.email} className="rounded-xl border p-4 flex items-start justify-between">
            <div>
              <div className="font-medium">{lead.name}</div>
              <div className="text-sm text-gray-300">{lead.company}</div>
              <div className="mt-2 text-sm">
                <div className="truncate"><span className="text-gray-300">Email:</span> {lead.email}</div>
                <div className="truncate"><span className="text-gray-300">Phone:</span> {lead.phone}</div>
              </div>
            </div>
            <button
              onClick={() => addToContacts(lead)}
              disabled={!!saving[lead.email]}
              className="rounded bg-white px-3 py-1.5 text-black hover:bg-gray-500 disabled:opacity-50"
            >
              {saving[lead.email] ? "Adding…" : "Add"}
            </button>
          </div>
        ))}
      </div>

      {note ? <div className="mt-3 text-xs text-gray-700">{note}</div> : null}
    </div>
  );
}
