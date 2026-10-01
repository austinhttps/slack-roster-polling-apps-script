# Slack Roster Sync & Interactive Polling Bot (Google Apps Script)

A production-ready Google Apps Script (V8 runtime) integration with Slack and Google Sheets. It provides two automated workflows:

1. **Bi-Directional Roster Sync Bot (`RosterWorkflow`)**: Synchronizes workspace member profiles and custom metadata between Google Sheets and Slack profiles using `users.list` and `users.profile.set`.
2. **Interactive Timed Polling Bot (`PollWorkflow`)**: Supports slash commands (`/poll`), Block Kit interactive voting with dynamic vote-tally bars (`⦿`/`○`), instant in-channel replacement (sub-second response), and automatic poll expiration with thread summaries.

---

## Architecture & File Structure

```
├── config.js             # Environment variable access, sheet column mapping, and Slack field IDs
├── core.js               # Sheet manager (auto-headers) and Slack API HTTP client (token routing)
├── workflows.js          # RosterWorkflow and PollWorkflow logic
├── main.js               # doPost webhook entrypoint, triggers, and spreadsheet custom menu
├── appsscript.json       # Apps Script manifest and OAuth scopes
├── .clasp.json.example   # Clasp configuration template
└── README.md             # Documentation and setup instructions
```

---

## Features

### 1. Roster Synchronization
* **PULL (`pullSlackData`)**:
  * Fetches workspace members via `users.list` (ignores bots and `USLACKBOT`).
  * Maps standard profile fields and custom profile metadata.
  * Preserves existing sheet data if corresponding Slack fields are blank.
  * Upserts by Slack User ID and marks account status (`Active` / `Deactivated`).
* **PUSH (`bulkPushToSlack`)**:
  * Iterates active members in Google Sheets and pushes edits to Slack via `users.profile.set`.
  * Gracefully skips deactivated accounts and handles admin/owner permission boundaries (`cannot_update_admin_user`).
  * Stamps updated timestamp in Column K (`Updated At`).
* **Daily Sync (`runDailySync`)**:
  * Runs both pull and push routines and broadcasts an aggregated report to your configured summary channel.

### 2. Interactive Polling
* **Slash Command (`/poll`)**:
  * Syntax: `/poll "Question" "Option 1" "Option 2" [duration]` (e.g. `30m`, `2h`, defaulting to `24h`).
  * Supports smart/curly quotes (`“`, `”`) and standard double quotes (`"`).
  * Sends Block Kit message with `<!channel>` broadcast and records state in `ActivePolls`.
* **Interactive Button Voting**:
  * Toggles user votes on button clicks (voting again removes the vote).
  * Directly returns updated Block Kit payloads in HTTP response to guarantee sub-second execution without Slack 3-second timeouts.
* **Auto-Expiration**:
  * Minute-level time-driven trigger (`minuteTrigger`).
  * Closes expired polls, disables buttons (`*CLOSED*`), and posts final tallies into the message thread.

---

## Setup & Installation

### Step 1: Clone Repository & Configure Clasp
```bash
git clone https://github.com/<your-username>/<your-repo-name>.git
cd <your-repo-name>
cp .clasp.json.example .clasp.json
```
Edit `.clasp.json` and insert your Google Apps Script `scriptId`.

Push files to your Apps Script project:
```bash
npx clasp login
npx clasp push
```

*(Alternatively, you can copy the `.js` files directly into the Apps Script online editor).*

---

### Step 2: Create Slack App & Set Scopes

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a **New App** (From scratch).
2. Go to **OAuth & Permissions**:
   * **Bot Token Scopes** (`xoxb-...`):
     * `commands`
     * `chat:write`
     * `users:read`
     * `users.profile:read`
   * **User Token Scopes** (`xoxp-...`):
     * `users.profile:write` *(Authorize as Primary Workspace Owner to enable editing all member profiles)*.
3. Install the app to your workspace and copy the tokens.

---

### Step 3: Configure Google Apps Script Properties

In the Google Apps Script editor, navigate to **Project Settings (⚙️)** > **Script Properties** and add:

| Property Name | Description | Example |
| :--- | :--- | :--- |
| `SLACK_TOKEN` | Bot User OAuth Token | `xoxb-...` |
| `USER_TOKEN` | User OAuth Token (Primary Owner) | `xoxp-...` |
| `SUMMARY_CHANNEL_ID` | Channel ID for sync summaries | `C0123456789` |

---

### Step 4: Deploy Web App & Set Slack URLs

1. In Apps Script, click **Deploy** > **New deployment**.
2. Select **Web app**:
   * **Execute as**: `Me`
   * **Who has access**: `Anyone`
3. Copy the **Web App URL**.
4. In Slack App Settings:
   * **Interactivity & Shortcuts**: Enable Interactivity and paste the **Web App URL** into **Request URL**.
   * **Slash Commands**: Create `/poll`, paste the **Web App URL** into **Request URL**.

---

### Step 5: Set Up Triggers (Automated Executions)

In Google Apps Script, click the **Triggers (⏰)** icon and add two triggers:

| Function | Event Source | Type | Interval |
| :--- | :--- | :--- | :--- |
| `minuteTrigger` | Time-driven | Minutes timer | Every minute |
| `runDailySync` | Time-driven | Day timer | Midnight to 1am (or preferred time) |

---

## Sheet Column References

### `Roster` Sheet
1. `User ID`
2. `Real Name`
3. `Display Name`
4. `Email`
5. `Phone`
6. `Chapter` *(Slack Field `Xf09MGK1C86Q`)*
7. `Age Range` *(Slack Field `Xf09N7BMLJTS`)*
8. `Membership` *(Slack Field `Xf09NKRWFND6`)*
9. `Member Group` *(Slack Field `Xf0A772PKPK9`)*
10. `Title` *(Slack Field `Xf06NT787AG3`)*
11. `Updated At`
12. `Status`

### `ActivePolls` Sheet
1. `Poll ID`
2. `Question`
3. `Status` (`Open` / `Closed`)
4. `Created At`
5. `Expires At`
6. `Channel ID`
7. `Message TS`
8. `Vote State` (JSON array)

---

## License
MIT
