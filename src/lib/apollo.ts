// @lib/apollo

export type ApolloContact = {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  phone_numbers?: { raw_number?: string }[];
  title?: string;
  linkedin_url?: string;
  company?: { name?: string; website_url?: string; domain?: string };
};

function keepDigitsPlus(s: string) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = ch.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    if (isDigit || ch === "+" || ch === " ") out += ch;
  }
  return out.trim();
}

function seniorityFromTitle(title?: string) {
  if (!title) return "";
  const t = title.toLowerCase();
  if (t.includes("chief") || t.includes("cxo") || t.includes("cfo") || t.includes("cto") || t.includes("ceo")) return "C-level";
  if (t.includes("vp") || t.includes("vice president")) return "VP";
  if (t.includes("director")) return "Director";
  if (t.includes("head of")) return "Head";
  if (t.includes("lead")) return "Lead";
  if (t.includes("manager")) return "Manager";
  return "";
}

export type NormalizedLead = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  title?: string;
  linkedinUrl?: string;
  company?: string;
  companyDomain?: string;
  seniority?: string;
};

// =============== Core fetch by domain (used across the app) ===============
export async function fetchApolloLeadsByDomain(
  domain: string,
  roleLike?: string,
  page = 1
): Promise<NormalizedLead[]> {
  const API = process.env.APOLLO_API_KEY || "";
  if (!API) throw new Error("APOLLO_API_KEY missing");

  // Placeholder endpoint/payload — adjust to your Apollo plan/contract.
  const res = await fetch("https://api.apollo.io/v1/contacts/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-API-Key": API
    },
    body: JSON.stringify({
      page,
      person_titles: roleLike ? [roleLike] : [],
      q_organization_domains: [domain],
      per_page: 50
    })
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error("Apollo error: " + msg);
  }

  const data = (await res.json()) as any;
  const people: ApolloContact[] = data?.contacts || data?.people || [];

  return people.map((p) => {
    const fn = p.first_name || (p.name ? p.name.split(" ")[0] : "");
    const ln = p.last_name || (p.name ? p.name.split(" ").slice(1).join(" ") : "");
    const rawPhone = (p.phone_numbers && p.phone_numbers[0]?.raw_number) || "";
    const phone = rawPhone ? keepDigitsPlus(String(rawPhone)) : undefined;

    return {
      firstName: String(fn || ""),
      lastName: String(ln || ""),
      email: String(p.email || ""),
      phone,
      title: p.title ? String(p.title) : undefined,
      linkedinUrl: p.linkedin_url ? String(p.linkedin_url) : undefined,
      company: p.company?.name ? String(p.company.name) : undefined,
      companyDomain:
        p.company?.domain
          ? String(p.company.domain)
          : p.company?.website_url
          ? String(p.company.website_url)
          : domain,
      seniority: seniorityFromTitle(p.title || "")
    };
  });
}

// =============== Convenience wrappers you import elsewhere ===============

type BasicPerson = {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
};

const personCache = new Map<string, BasicPerson>();

function leadId(lead: NormalizedLead, index: number, domain: string) {
  // Stable id if email exists; otherwise derive from fields.
  return lead.email
    ? `lead:${lead.email.toLowerCase()}`
    : `lead:${(lead.firstName || "unknown").toLowerCase()}-${(lead.lastName || "").toLowerCase()}-${(lead.title || "na").toLowerCase()}-${(lead.companyDomain || domain).toLowerCase()}-${index}`;
}

function dedupeByKey(items: NormalizedLead[]) {
  const seen = new Map<string, NormalizedLead>();
  for (const it of items) {
    const key = (it.email || `${it.firstName}|${it.lastName}|${it.title}|${it.companyDomain}`).toLowerCase();
    if (!seen.has(key)) seen.set(key, it);
  }
  return Array.from(seen.values());
}

export async function searchPeopleByDomain(
  domain: string,
  titles: string[] = [],
  perPage = 5
): Promise<BasicPerson[]> {
  const all: NormalizedLead[] = [];

  if (titles.length > 0) {
    for (const t of titles) {
      const chunk = await fetchApolloLeadsByDomain(domain, t, 1);
      all.push(...chunk);
    }
  } else {
    const chunk = await fetchApolloLeadsByDomain(domain, undefined, 1);
    all.push(...chunk);
  }

  const deduped = dedupeByKey(all).slice(0, perPage);

  const results: BasicPerson[] = deduped.map((l, i) => {
    const id = leadId(l, i, domain);
    const person: BasicPerson = {
      id,
      first_name: l.firstName,
      last_name: l.lastName,
      title: l.title,
      email: l.email || undefined,
      phone: l.phone || undefined,
      linkedin_url: l.linkedinUrl
    };
    personCache.set(id, person);
    return person;
  });

  return results;
}

// Placeholder “reveal” that returns what we cached in search.
// If you later wire Apollo’s paid reveal endpoint, call it here
// and update the cache with any newly revealed fields (email/phone).
export async function revealPersonContact({ id }: { id: string }): Promise<BasicPerson | null> {
  return personCache.get(id) || null;
}

// =============== Name + Company search (for news prospects) ===============
export async function fetchApolloContactByNameCompany(
  personName: string,
  companyName: string
): Promise<NormalizedLead | null> {
  const API = process.env.APOLLO_API_KEY || "";
  if (!API) return null;

  const res = await fetch("https://api.apollo.io/v1/contacts/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-API-Key": API
    },
    body: JSON.stringify({
      page: 1,
      per_page: 10,
      person_name: personName,
      organization_names: [companyName]
    })
  });

  if (!res.ok) {
    // Be forgiving: just return null so the cron can continue gracefully
    return null;
  }

  const data = (await res.json()) as any;
  const people: ApolloContact[] = data?.contacts || data?.people || [];
  if (!Array.isArray(people) || people.length === 0) return null;

  const p = people[0];

  const fn = p.first_name || (p.name ? String(p.name).split(" ")[0] : "");
  const ln = p.last_name || (p.name ? String(p.name).split(" ").slice(1).join(" ") : "");
  const rawPhone = (p.phone_numbers && p.phone_numbers[0]?.raw_number) || "";
  const phone = rawPhone ? keepDigitsPlus(String(rawPhone)) : undefined;

  return {
    firstName: String(fn || ""),
    lastName: String(ln || ""),
    email: String(p.email || ""),
    phone,
    title: p.title ? String(p.title) : undefined,
    linkedinUrl: p.linkedin_url ? String(p.linkedin_url) : undefined,
    company: p.company?.name ? String(p.company.name) : companyName,
    companyDomain:
      p.company?.domain
        ? String(p.company.domain)
        : p.company?.website_url
        ? String(p.company.website_url)
        : undefined,
    seniority: seniorityFromTitle(p.title || "")
  };
}
