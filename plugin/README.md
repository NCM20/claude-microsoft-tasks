# microsoft-tasks

Microsoft Planner and Microsoft To Do in Claude Cowork.

Ask for what you actually want:

- "What's on my plate this week?"
- "Add a task to remind me to renew the SSL cert before Friday."
- "How is the Q3 Migration board looking? Anything overdue or unassigned?"
- "Turn the action items from these notes into tasks and assign the DNS one to
  Sarah."
- "Move the vendor review task to In Progress and tick off the first two steps."

Claude reads both systems when you ask what is outstanding, because commitments
land in whichever one you happened to be using at the time.

## Setup

This plugin talks to a Microsoft Graph MCP server that your organisation hosts.
Before installing, `.mcp.json` needs the server URL and the Entra application
client ID filled in. See the [repository README](../README.md).

Once installed, Cowork prompts you to sign in to Microsoft. Everything happens
as you: if you cannot see a plan in Planner, Claude cannot see it either.

## What it will and will not do on its own

Reads freely. Asks first before deleting anything, before writing to a shared
Planner board, and before assigning work to somebody else.

It cannot create plans, set up recurring tasks, or add attachments. It will tell
you so rather than pretending otherwise.
