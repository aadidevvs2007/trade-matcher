# Trade Matcher

An MCP server built with [NitroStack](https://nitrostack.ai) for the NitroStack × MCP Hackathon (Amrita Coimbatore, July 25-26).

## What it does

Trade Matcher reconciles trades between two mock trading systems (System A and System B), detecting matches, price/quantity discrepancies, and unmatched trades — a common problem in financial back-office operations.

## Tools

| Tool | Description |
|------|-------------|
| `load_trades` | Loads mock trades from System A, System B, or both |
| `matchTrades` | *(in progress)* Matches trades across systems and flags discrepancies |

## Tech Stack

- [NitroStack](https://nitrostack.ai) — TypeScript MCP framework
- TypeScript
- Zod (schema validation)

## Getting Started

```bash
npm install
npm run dev
```

Open the project folder in [NitroStudio](https://nitrostack.ai/studio) to test tools interactively.

## Team

- **Aadidev VS**
- **Ragul Ponraj**
- **Bavish Nithin**
- **Agastya Vuppala**

## Project Status

🚧 In progress — built during a 48-hour hackathon sprint.