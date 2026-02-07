---
name: meme
description: "Generate memes using the free memegen.link API. Create image memes from 200+ templates with custom top/bottom text, or use textual meme formats."
metadata:
  { "requires": { "bins": ["curl"] } }
---

# Meme Generator Skill

Generate memes using the memegen.link API. No API key needed.

## URL Format

```
https://api.memegen.link/images/{template}/{top_text}/{bottom_text}.png
```

## Text Encoding

| Character | Encoding |
|-----------|----------|
| Space | `_` or `-` |
| Newline | `~n` |
| Question mark | `~q` |
| Percent | `~p` |
| Slash | `~s` |
| Hash | `~h` |
| Single quote | `''` |
| Double quote | `""` |

## Popular Templates

| Template | Name | Use case |
|----------|------|----------|
| `drake` | Drakeposting | Comparing two things (reject/prefer) |
| `fry` | Futurama Fry | "Not sure if X or Y" |
| `fine` | This is Fine | Everything is on fire |
| `buzz` | X, X Everywhere | Something ubiquitous |
| `gru` | Gru's Plan | Plans backfiring |
| `astronaut` | Always Has Been | Revelations |
| `db` | Distracted Boyfriend | Misplaced priorities |
| `cmm` | Change My Mind | Hot takes |
| `harold` | Hide the Pain Harold | Hidden suffering |
| `panik-kalm-panik` | Panik Kalm Panik | Emotional rollercoaster |
| `spiderman` | Spider-Man Pointing | Two things that are the same |
| `same` | They're The Same Picture | Identical things |
| `exit` | Left Exit 12 Off Ramp | Bad decisions |
| `pooh` | Tuxedo Winnie the Pooh | Classy alternative |
| `stonks` | Stonks | Financial "wisdom" |
| `mordor` | One Does Not Simply | Something difficult |
| `woman-cat` | Woman Yelling at a Cat | Arguments |
| `handshake` | Epic Handshake | Shared agreement |
| `success` | Success Kid | Celebrating wins |
| `interesting` | Most Interesting Man | "I don't always X" |
| `slap` | Will Smith Slap | Strong reactions |
| `chair` | American Chopper Argument | Heated arguments |
| `rollsafe` | Roll Safe | Bad "smart" ideas |

## Browsing Templates

Before generating a meme, browse the API to find the right template. Don't just guess — fetch the list.

List all templates:

```bash
curl -s https://api.memegen.link/templates/ | jq '.[] | {id, name}'
```

Search for a template by keyword:

```bash
curl -s https://api.memegen.link/templates/ | jq '.[] | select(.name | test("keyword"; "i")) | {id, name}'
```

Get details and example URL for a specific template:

```bash
curl -s https://api.memegen.link/templates/{id}
```

Always browse first if the user asks for a specific vibe or if you're unsure which template fits best.

## Generating a Meme

1. Browse templates from the API to pick the best fit
2. Encode the text (underscores for spaces, special char codes)
3. Keep text short — 2-6 words per line for readability
4. Build the URL and verify with curl:

```bash
curl -s -o meme.png "https://api.memegen.link/images/{template}/{top}/{bottom}.png"
```

5. Read the downloaded image to display it to the user

## Options

| Parameter | Example |
|-----------|---------|
| Width | `?width=800` |
| Height | `?height=600` |
| Layout | `?layout=top` or `?layout=bottom` |
| Format | `.png`, `.jpg`, `.webp`, `.gif` |

## Custom Background Image

```
https://api.memegen.link/images/custom/{top}/{bottom}.png?style=https://example.com/image.jpg
```

## Workflow

1. Understand the vibe/context from the user
2. Browse templates from the API — don't assume a template exists, verify it
3. Pick the right template (match template meaning to the joke)
4. Write short punchy text
5. Download the image with curl
6. Read the image file to show it inline
7. Clean up the file after if needed

## Examples

```bash
# deployment humor
curl -s -o meme.png "https://api.memegen.link/images/fine/servers_on_fire/this_is_fine.png"

# code review
curl -s -o meme.png "https://api.memegen.link/images/fry/not_sure_if_bug/or_feature.png"

# comparing approaches
curl -s -o meme.png "https://api.memegen.link/images/drake/writing_tests/shipping_to_prod.png"
```
