# Prompters Anonymous

A 12-step program for getting your thinking back from AI, one small step at a time.

Website: [promptersanon.com](https://promptersanon.com)

## What it is

Prompters Anonymous is a free plugin for [Claude Code](https://claude.com/claude-code). It is for developers who lean on AI for most of their thinking.

It does not ask you to quit AI. Instead, each step adds a little friction to how you already work. Friction here means a small speed bump that makes you think before AI does the work. Over time, you rebuild the problem-solving skills that may have faded.

You keep building your real project. Nothing here is a separate exercise. Your history stays on your computer.

## The 12 steps

- **Steps 1–3: Admit it.** Notice the habit. Guess before you ask. Explain what changed.
- **Steps 4–8: Own the thinking.** Take back architecture, alternatives, edge cases, error states and recovery, and performance. AI still types, but you decide.
- **Steps 9–11: Own the typing.** Wire things up yourself. Write tests first. Write a whole module yourself.
- **Step 12: Graduation.** Build one small, complete feature with AI turned off. Then set your own rules.

Steps 1 to 3 are ready today. Steps 4 to 12 are still being built.

## Install

You need Claude Code 2.1.290 or newer. Run these inside Claude Code:

```
/plugin marketplace add tommyshellberg/prompters-anonymous
/plugin install pa@promptersanon
/pa setup
```

`/pa setup` welcomes you and asks why you installed it. It saves your answer word for word, so it can remind you on hard days. Then it starts you on step 1.

## How it works

- Everyone starts at step 1.
- It runs inside your normal Claude Code workflow.
- A line above the prompt box shows your current step and progress.
- Claude tells you when you are ready to move up. Moving up is always your choice.
- On a rough day you can ease off. Your progress is never erased.

## Commands

| Command | What it does |
|---|---|
| `/pa` | Shows your why, your step, and your progress toward the next step. |
| `/pa setup` | Welcomes you, asks your why, and starts step 1. |
| `/pa up` | Moves you up a step when you are ready. If you are not ready yet, it tells you how far you are. |
| `/pa down` | Steps down one step, once a week at most. Your progress on the higher step is saved. |
| `/pa rough-day` | Drops you one step until midnight, your local time. Use it when you are tired and just need to ship. |

## Privacy

Nothing is sent anywhere. All data stays in a file on your computer.

The plugin tracks:

- your current step
- how your guesses and explanations were scored
- a count of each prompt's rough type: planning, code, debugging, explaining, or other

It never saves the text of your prompts. The only words it keeps are ones you type to it on purpose, such as why you started.

See [plugins/pa/README.md](plugins/pa/README.md) for the full details.

## FAQ

**Do I have to stop using AI?**
No. You keep using it, just differently. Step 12 is one feature built without AI. After that, the rules are yours.

**Will it slow me down?**
A little at first, by design. Step 2, for example, costs you one sentence per question.

**Does it work with other tools?**
Not yet. It is built on Claude Code's plugin system. You can still follow the steps by hand with any tool.

**Is it affiliated with Alcoholics Anonymous or Anthropic?**
No. It is an independent project that borrows the 12-step format. If you are struggling with addiction, please reach out to AA or a local support service.

## Repository layout

- `.claude-plugin/marketplace.json` lists the plugin so Claude Code can install it.
- `plugins/pa/` holds the plugin itself.
- `plugins/pa/steps/` holds the text for each of the 12 steps.
- `plugins/pa/src/` holds the code that tracks your step and progress.
