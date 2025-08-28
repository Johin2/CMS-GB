// src/lib/tokens.js
/**
 * Supports: default value and simple transforms with pipes.
 * Example: {{first_name|there|title}} => "Alicia" -> "Alicia", "" -> "There"
 */
export function fillTokens(template, vars) {
  if (!template) return "";
  let out = "";
  let i = 0;

  while (i < template.length) {
    const start = template.indexOf("{{", i);
    if (start === -1) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, start);

    const end = template.indexOf("}}", start + 2);
    if (end === -1) {
      out += template.slice(start);
      break;
    }

    const raw = template.slice(start + 2, end).trim();

    // split by | without regex
    const parts = [];
    {
      let buf = "";
      for (let k = 0; k < raw.length; k++) {
        const ch = raw[k];
        if (ch === "|") {
          parts.push(buf.trim());
          buf = "";
        } else {
          buf += ch;
        }
      }
      parts.push(buf.trim());
    }

    const name = parts.shift() || "";
    let def;
    const transforms = [];
    for (const p of parts) {
      const low = p.toLowerCase();
      if (["upper", "lower", "title", "trim"].includes(low)) transforms.push(low);
      else if (def === undefined) def = p;
    }

    let val = Object.prototype.hasOwnProperty.call(vars || {}, name) ? vars[name] : undefined;
    if (val === undefined || val === null || val === "") val = def !== undefined ? def : "";
    let s = String(val);

    for (const t of transforms) {
      if (t === "trim") s = s.trim();
      else if (t === "upper") s = s.toUpperCase();
      else if (t === "lower") s = s.toLowerCase();
      else if (t === "title") {
        const words = s.split(" ");
        for (let w = 0; w < words.length; w++) {
          const word = words[w];
          if (word) words[w] = word[0].toUpperCase() + word.slice(1).toLowerCase();
        }
        s = words.join(" ");
      }
    }

    out += s;
    i = end + 2;
  }

  return out;
}
