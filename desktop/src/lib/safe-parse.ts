import { jsonrepair } from "jsonrepair"

// how far back to trim a prefix that neither closer can parse
const MAX_BACKOFF = 8

// streaming tool input is valid json cut at an arbitrary point. close it exactly where it was
// cut so every delta only ever extends the values. jsonrepair guesses where an unterminated
// string should end (it rewinds to an earlier delimiter), which made stream cards jump.
function closePrefix(input: string): any {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const ch of input) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") stack.pop()
  }

  let text = input
  if (inString) {
    // drop a half-written escape, then end the string at the cut
    text = text.replace(/\\u[0-9a-fA-F]{0,3}$/, "")
    if (escaped) text = text.slice(0, -1)
    text += '"'
  }
  text = text.replace(/[\s,]+$/, "")
  if (stack[stack.length - 1] === "{") {
    // a key with no value yet: drop it (and its comma), or give a bare colon a null value
    const danglingKey = /([{,])\s*"(?:[^"\\]|\\.)*"\s*$/
    if (/:\s*$/.test(text)) text += "null"
    else if (danglingKey.test(text)) text = text.replace(danglingKey, (_, open) => (open === "{" ? "{" : ""))
  }
  for (let i = stack.length - 1; i >= 0; i--) text += stack[i] === "{" ? "}" : "]"
  return JSON.parse(text)
}

// parse partial/streaming JSON
export function safeParse(input: string): any {
  if (!input) return {}
  try {
    return JSON.parse(input)
  } catch {}
  try {
    return closePrefix(input)
  } catch {}
  for (let cut = 0; cut <= MAX_BACKOFF && cut < input.length; cut++) {
    try {
      return JSON.parse(jsonrepair(input.slice(0, input.length - cut)))
    } catch {}
  }
  return {}
}
