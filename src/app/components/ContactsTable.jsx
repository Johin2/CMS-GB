import React from "react";
import Card from "./Card";
import { Users, Plus, ExternalLink } from "lucide-react";

export default function ContactsTable({ rows = [] }) {
  const badge = (status) => {
    const map = {
      new: "bg-gray-100 text-gray-700",
      queued: "bg-amber-100 text-amber-700",
      sent: "bg-emerald-100 text-emerald-700",
      bounced: "bg-rose-100 text-rose-700",
    };
    return `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status] || ""}`;
  };

  return (
    <Card title="Recent contacts" action={<a className="text-sm text-white hover:underline" href="#">View all</a>}>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center">
          <Users className="h-8 w-8 text-gray-400" />
          <p className="mt-3 text-sm text-gray-600">
            No contacts yet. Pull people by domain using Apollo or add manually.
          </p>
          <div className="mt-4 flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-gray-500">
              <Plus className="h-4 w-4" /> New contact
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <ExternalLink className="h-4 w-4" /> Open /contacts
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Company</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-black">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 text-sm text-gray-800">{r.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{r.role}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{r.company}</td>
                  <td className="px-4 py-3">
                    <span className={badge(r.status)}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
