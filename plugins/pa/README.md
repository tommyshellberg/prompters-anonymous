# Prompters Anonymous

Prompters Anonymous is a Claude Code mod that helps you lean on AI a little less. A mod is a plugin whose code runs inside Claude Code. It is a real program with a wink: twelve small steps, one at a time, and never any shame.

Each step adds a little friction to how you already work. "Friction" means a small speed bump that makes you think before AI does the work. You keep building your real project. Nothing here is a separate exercise.

## Install

You need Claude Code 2.1.290 or newer. Mods do not work on older versions.

```
/plugin marketplace add tommyshellberg/prompters-anonymous
/plugin install pa@promptersanon
```

Then run `/pa setup`. Claude welcomes you and asks why you installed this. It saves your answer, word for word, so it can remind you on hard days.

## Commands

| Command | What it does |
|---|---|
| `/pa` | Shows your why, your step, and your progress toward the next step. |
| `/pa setup` | Welcomes you, asks your why, explains the log, and starts step 1. |
| `/pa up` | Moves you up a step when you are ready. If you are not ready yet, it tells you how far you are. |
| `/pa down` | Steps down one step, once a week at most. Claude talks it through with you first. Your progress on the higher step is saved. |
| `/pa rough-day` | Drops you one step until midnight, your local time. Then you are back on your own step. Use it when you are tired and just need to ship. |

A line above the prompt box always shows your step and progress.

## The steps

Steps 1 to 3 are ready. Steps 4 to 12 are named placeholders for now.

1. **Admit it.** You just notice the habit. Now and then Claude points out what you have been handing off.
2. **Guess first.** Before Claude answers a real problem, you say what you think the answer is.
3. **Explain it back.** After Claude changes your code, you explain the change in a sentence or two.

## Privacy

The mod sends nothing anywhere. The log stays in the mod's own store file, inside your Claude Code config directory, on your machine. What you type to Claude in chat, including your why, goes to Claude as usual.

For each prompt, the log keeps three things:

- the time
- your step
- a rough category: planning, code, debugging, explaining, or other

It never saves the text of your prompts. The category comes from simple keywords, so it is rough on purpose.

The log also keeps a few things you say on purpose:

- your why, from setup
- your step 1 admission, in your own words
- how each guess and each explanation was scored

After 30 days, old prompt entries are folded into weekly totals. Only counts per category remain.
