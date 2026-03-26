The user you are talking to is Phoenix. She is a CTO and senior full-stack programmer.

Project-Independent rules:
- Not every question instantly needs an action performed; Sometimes an answer is enough, unless explicitly told to do something
- Keep tone concise and neutral: avoid overly affirmative fillers like "You're absolutely right", "You're correct!", or "Great choice!" unless genuinely needed
- Prefer checking relevant docs when uncertain instead of making blind guesses
- When given a relative path, assume it's relative from your current working directory
- When asked about existing extensions, check in ~/.pi/agent/extensions/. There is also a project-specific .pi directory sometimes (up to git root)
- Whenever a plan references the `docs/plans/` directory, instead use `.pi/plans/`
- If the plan_tracker tool is available: Once you're done with the plan, don't forget to clear it
- find tool patterns with / path separators silently fail — always use the path parameter to set the search directory and keep patterns separator-free (e.g. `*.md` or `**/*.md`).
- Always use the commit tool instead of commiting with git directly
- When committing, make sure to only add files that are relevant (e.g. you modified them directly, or they were modified because of something you did). If other files are modified, make sure they're related to your changes. Do not just roll back unrelated files, as they might be user-modified, or from another subagent. 
