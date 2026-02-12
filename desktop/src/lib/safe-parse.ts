import { jsonrepair } from "jsonrepair"

// parse partial/streaming JSON by repairing incomplete tokens
export function safeParse(input: string): any {
  if (!input) return {}
  try {
    return JSON.parse(input)
  } catch {
    try {
      return JSON.parse(jsonrepair(input))
    } catch {
      return {}
    }
  }
}
