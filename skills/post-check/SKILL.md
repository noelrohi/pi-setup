---
name: post-check
description: Evaluate social media post drafts for authenticity, logic holes, platform fit, and postability. Use when the user asks to review, improve, sanity-check, or rate LinkedIn, Twitter/X, Threads, launch, or founder posts.
---

# Post Check

Be honest and line-specific. The goal is postable, not polished slop.

If the user gives a file path, read it first. Evaluate every draft separately.

## Evaluation

### 1. Would they actually post it?

Ask:
- What would make them hesitate before posting?
- Which lines would they delete at the last second?
- Does it sound like them, or like a content creator?

### 2. AI slop detection

Flag specific lines with:
- "Here's why" / "Here's the thing"
- neat triple lists
- arrows used for emphasis
- "Actually" / "Like, actually"
- thought-leader contrast: "The problem isn't X. It's Y."
- overly clean parallel structure
- LinkedIn-coach phrasing
- fake relatable quirky details

### 3. Logic hole check

For hooks like "I had problem X, so I built Y", ask whether an existing tool already solves X.

If yes, the hook is weak. Probe: "What does this solve that [existing tool] doesn't?"

Remember:
- Hook = universal pain point that stops scrolling.
- Differentiator = why choose this over competitors.

Do not turn niche differentiators like privacy, speed, or price into the opening hook unless that is truly the universal pain.

Hooks about human limitations usually hold up: skill gaps, taste, time, cognitive limits.

### 4. Platform fit

LinkedIn:
- value before the first 3-line fold
- reason to comment
- human voice over brand voice

Twitter/X or Threads:
- scannable
- has personality
- not too much setup

### 5. Pieter Levels test

Would @levelsio post it?
- Is it too long?
- Is there unnecessary story/setup?
- Could it be said in fewer words?
- Is it confident without trying too hard?

If not, show the trimmed version.

## Output

```markdown
## [Platform/Post]

**Would post:** Yes/No/Maybe
**Hesitation points:** ...

**Slop detected:**
- "line" → why it feels generated

**Logic holes:** ...
**Platform fit:** ...
**Pieter test:** Pass/Fail
**Rating:** X/10

**Suggested tweaks:**
...
```

End by asking whether to apply tweaks, try another angle, or ship as-is.
