// src/lib/templates.js

export const DEFAULT_TEMPLATES = {
  RELATIONSHIPS_MONTHLY_CEO: {
    subject: "Monthly update: how {{company}} is compounding results",
    body: `Hi {{first_name}},

Quick one-pager on what we shipped in {{month}} and the outcomes for peers in {{category}}.
If helpful, we can brief your leadership on “what great looks like” this quarter.

— {{sender_name}}`
  },
  NEW_CMO_INITIAL: {
    subject: "Congrats on the new role, {{first_name}} — fast wins in {{category}}",
    body: `Hi {{first_name}}, congrats on joining {{company}}.

We mapped {{category}} innovations in India & globally and overlaid them with your past work.
Happy to share a 90-day roadmap tailored to {{company}}.

— {{sender_name}}`
  }
};
