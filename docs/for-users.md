# Microsoft Planner and To Do in Claude

Ask Claude about your work in plain language and it reads and updates your real
tasks. Both systems, one conversation.

Everything happens as you. Claude sees exactly the plans and lists your own
Microsoft account can see, and nothing else.

## Install it

Takes about five minutes, once.

1. Open Claude and go to **Customize** in the sidebar, then **Plugins**.
2. Click **Add marketplace** and enter:

   ```
   NCM20/claude-microsoft-tasks
   ```

3. Find **microsoft-tasks** in the list and click **Install**.
4. Click **Connect** and sign in with your NCM account.
5. Ask it *"What's on my plate this week?"* to check it worked.

If step 2 says the repository isn't accessible, use claude.ai in a browser
rather than the desktop app. Same account, same plugin.

## What the sign-in asks for

Microsoft will show you a permissions screen. Read it, but here's the summary.

Claude gets to read and write your tasks, look up colleagues by name in the
company directory, and stay signed in so you aren't prompted every day.

It gets no access to your email, your files, your calendar, or your Teams
messages. If you're wondering whether it can read a document you were sent, it
can't.

## Things to ask

**Catching up**

- What's on my plate this week?
- Anything overdue?
- What did I finish last week?

**Your own tasks**

- Remind me to renew the SSL cert before Friday.
- Add "draft the Q3 summary" to my Tasks list, high importance.
- Mark the vendor review as done.

**Team boards**

- How's the LightEdge Migration board looking?
- Anything on Ops Leadership with no assignee?
- Move the DNS cutover task to In Progress.
- Who's got the most open work on SLT Team Tasks?

**Turning talk into tasks**

- Here are my notes from the standup. Turn the action items into tasks.
- Everything I committed to in this thread, put on my list with dates.

That last one is where it earns its keep. Paste raw meeting notes and it works
out what the commitment actually is, whose it is, and which system it belongs
in.

## How it decides where a task goes

Personal work goes to Microsoft To Do. Anything on a team board, or assigned to
someone else, goes to Planner.

When it isn't obvious, Claude asks rather than guessing. That's deliberate.
Guessing wrong either puts a private note somewhere your whole department reads
it, or buries a team commitment where nobody else will see it.

## What it won't do

It asks before deleting anything, before writing to a shared Planner board, and
before assigning work to somebody else. Reading never needs permission.

Four things it genuinely can't do, and it will say so rather than improvise:

- Create or delete plans, or change who's on a team
- Set up a recurring task. Create it in the To Do app and Claude will handle it
  from then on
- Add attachments, though it can read links already on a task
- See anyone else's To Do lists. Only Planner is shared

## When something looks wrong

**It says it isn't connected.** Open the plugin under Customize → Plugins and
click Connect. Sign-ins expire.

**It found the wrong tasks.** Check which account you connected. If you have
more than one Microsoft login, it's easy to authorise the wrong one. Ask Claude
*"which Microsoft account am I connected as?"*

**A due date landed a day off.** Tell Claude the date you meant. It resolves
things like "Friday" itself and states the date it picked, so correct it when
that's wrong.

**It can't see a plan you know exists.** You're probably not a member of the
group that owns it. Planner permissions are Microsoft's, unchanged.

Anything else, send it to Chad Harp with what you asked and what came back.

## Where your data goes

Your tasks go from Microsoft to Claude and back. NCM runs the connector itself,
it stores nothing, and no task data is retained anywhere in between.
