DEFIED LUMINATE HELPER
======================

What it does
------------
Once a week you export your 4 Luminate portfolios (Admin Catalog 1, Admin Catalog 2, Artist Tracker,
Song Tracker) with the period set to 1 week and the territory Worldwide. Today you then drag the
files onto the dashboard. With the helper you don't: it watches your Downloads folder, waits until
each file has finished downloading, sends it to the dashboard, and moves it into
"Downloads/Luminate (done)".

The dashboard checks every file the same way the drop zone does. When the checks pass, the week is
applied by itself: the pub sheet's STREAM DATA, the clients' numbers on the site, and the A&R lists.
ClickUp's Dashboard Alerts channel gets one line, and the week's "Luminate update" task ticks that
portfolio off.

A file is held back for you to look at on the Luminate page (Apply or Discard) when:
  - it covers more than about a week (like a 26-week export),
  - its all-time numbers went down (usually it wasn't set to Worldwide),
  - it's from a portfolio the dashboard hasn't seen before.
ClickUp tells you when that happens.

What you need
-------------
  - A Mac, with Node 20 or newer (https://nodejs.org). Nothing else gets installed.
  - This Mac's token. Someone with access to the site's settings on Vercel adds it to the
    LUMINATE_HELPER_TOKEN setting, as name:token (several Macs: separate them with commas), for
    example:   studio-mac:<a long random token>
    A token must be at least 24 characters. Make one with:
        node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
    Until LUMINATE_HELPER_TOKEN is set, the site refuses the helper and nothing is written.

Install (you run this yourself)
-------------------------------
    cd <this folder>
    ./install.sh
It asks for the token (hidden while you type) and a name for this Mac, copies the helper to
~/Library/Application Support/Defied Luminate Helper, and starts it in the background. It starts again
by itself whenever you sign in to the Mac.

macOS asks before a background program can read Downloads. If the log says it can't read Downloads,
open System Settings > Privacy & Security > Files and Folders (or Full Disk Access) and allow "node".

Check that it works
-------------------
    node ~/Library/Application\ Support/Defied\ Luminate\ Helper/luminate-helper.mjs --check
says "OK: ... knows this Mac as ...". The dashboard's Luminate page shows when the helper last checked
in. Its log is in ~/Library/Logs/Defied Luminate Helper/helper.log.

To send what's in Downloads right now and stop:   luminate-helper.mjs --once

Uninstall
---------
    ./uninstall.sh          stops it and removes it from launchd (your config stays)
    ./uninstall.sh --all    also removes the config and the export bot's Chrome profile

Files it touches
----------------
  Reads:   ~/Downloads/portfolio-export-POR....csv (only files named like Luminate's exports)
  Moves:   those files, after the site answered for them, to ~/Downloads/Luminate (done)/
  Writes:  its log; nothing else on your Mac
  Sends:   the CSV files and a check-in, to the dashboard only (https://www.defiedmgmt.com)


THE EXPORT BOT (built, OFF, your decision)
==========================================
export-bot.mjs is a fixed script (no AI in it) that would do the exporting too: it opens each of the 4
portfolio pages in a Chrome profile of its own, sets 1 week and Worldwide, presses Export CSV, and lets
the helper pick the files up. It only ever goes to those 4 pages and only clicks the period control,
the territory control, their "1 Week" / "Worldwide" options and Export. On anything unexpected
(signed out, a button missing or there twice, a pop-up, a page it didn't open, no file) it stops at
once, keeps a screenshot, and the dashboard posts it to ClickUp.

It is OFF and stays off unless you turn it on, because of Luminate's Terms of Use (last updated
March 2026, https://luminatedata.com/terms-of-use/):
  - 2.3(h): you may not "use any automated crawlers or wrappers to attempt to reconstruct the Data
    via your API or any SaaS interface".
  - 2.3(i): restricts robots, screen scraping and similar tools (in connection with AI), and using AI
    tools with Luminate Content outside a private, no-training setup.
  - 2.1: Luminate may monitor use; 6.2: Luminate may suspend or end access.
Pressing Export on your own portfolios once a week is about as light as automation gets, and the bot
never reads the data on the page, but it is still a script driving Luminate's site, and the terms can
be read to cover it. The safe path is to ask Luminate in writing first (your account rep, or
help@luminatedata.com) whether automating your own weekly exports is allowed; a written yes, or a
clause in your order form, removes the risk. Luminate's own Report Scheduler (scheduled Trend
Reports) and its paid Music API are the official ways to automate this.

If you decide to use it:
  1. ./install.sh --with-bot     (adds puppeteer-core next to the bot and a Monday 9:30 AM job)
  2. In ~/Library/Application Support/Defied Luminate Helper/bot-config.json set "enabled": true
  3. Sign in once, in the bot's own Chrome window:   node export-bot.mjs --sign-in
     (it opens Luminate; sign in by hand, then close the window. Your password is never stored by
     the bot; the sign-in lives in that Chrome profile only. Don't share the login, 2.2.)
  4. Try it without exporting:   node export-bot.mjs --dry-run
     Screenshots of every step: ~/Library/Logs/Defied Luminate Helper/bot/
  5. Turn it off again any time: set "enabled": false, or ./uninstall.sh
If Luminate renames a button, the words the bot looks for are in bot-config.json under "ui".
