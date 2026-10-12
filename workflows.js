const RosterWorkflow = {
  /**
   * PULL: Grabs everything from Slack and updates the Spreadsheet
   */
  pullSlackData() {
    const result = Core.slackApi("users.list", {});
    if (!result.ok) throw new Error("Slack Pull Failed: " + result.error);

    const sheet = Core.getSheet(ROSTER_CONFIG.SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const idMap = {}; 
    data.forEach((row, index) => { if (row[0]) idMap[row[0]] = index + 1; });

    let added = 0;
    let updated = 0;

    result.members.forEach((m) => {
      if (m.is_bot || m.id === "USLACKBOT") return;

      const p = m.profile || {};
      const f = p.fields || {};

      const getVal = (slackVal, currentSheetVal) => 
        (slackVal !== undefined && slackVal !== null && slackVal !== "") ? slackVal : (currentSheetVal || "");

      const existingRowIndex = idMap[m.id];
      const existingRow = existingRowIndex ? data[existingRowIndex - 1] : [];

      const accountStatus = m.deleted ? "Deactivated" : "Active";

      const rowData = [
        m.id,                                                                   // 0 (A) - ID
        getVal(m.real_name || p.real_name, existingRow[1]),                     // 1 (B) - Real Name
        getVal(p.display_name, existingRow[2]),                                 // 2 (C) - Display Name
        getVal(p.email, existingRow[3]),                                        // 3 (D) - Email
        getVal(p.phone, existingRow[4]),                                        // 4 (E) - Phone
        getVal(f[SLACK_CUSTOM_FIELDS.CHAPTER]?.value, existingRow[5]),          // 5 (F)
        getVal(f[SLACK_CUSTOM_FIELDS.AGE_RANGE]?.value, existingRow[6]),        // 6 (G)
        getVal(f[SLACK_CUSTOM_FIELDS.MEMBERSHIP]?.value, existingRow[7]),       // 7 (H)
        getVal(f[SLACK_CUSTOM_FIELDS.MEMBER_GROUP]?.value, existingRow[8]),     // 8 (I)
        getVal(f[SLACK_CUSTOM_FIELDS.TITLE]?.value || p.title, existingRow[9]), // 9 (J) - TITLE
        new Date(),                                                             // 10 (K) - UPDATED
        accountStatus                                                           // 11 (L) - STATUS
      ];

      if (existingRowIndex) {
        sheet.getRange(existingRowIndex, 1, 1, rowData.length).setValues([rowData]);
        updated++;
      } else {
        sheet.appendRow(rowData);
        added++;
      }
    });

    return `Pull Complete: ${added} added, ${updated} updated.`;
  },

  /**
   * PUSH: Takes Spreadsheet edits and sends them to Slack.
   * Skips accounts where Column L (Status) is "Deactivated".
   */
  bulkPushToSlack() {
    const sheet = Core.getSheet(ROSTER_CONFIG.SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    let count = 0;
    let skipped = 0;
    let adminSkipped = 0;

    for (let i = 1; i < data.length; i++) {
      const userId = data[i][0];   // Col A
      const status = data[i][11];  // Col L - STATUS
      
      if (!userId || status === "Deactivated") {
        if (status === "Deactivated") skipped++;
        continue;
      }

      const profile = {
        real_name: String(data[i][1] || ""),
        display_name: String(data[i][2] || ""),
        email: String(data[i][3] || ""),
        phone: String(data[i][4] || ""),
        title: String(data[i][9] || ""),
        fields: {}
      };

      profile.fields[SLACK_CUSTOM_FIELDS.CHAPTER] = { value: String(data[i][5] || "") };
      profile.fields[SLACK_CUSTOM_FIELDS.AGE_RANGE] = { value: String(data[i][6] || "") };
      profile.fields[SLACK_CUSTOM_FIELDS.MEMBERSHIP] = { value: String(data[i][7] || "") };
      profile.fields[SLACK_CUSTOM_FIELDS.MEMBER_GROUP] = { value: String(data[i][8] || "") };
      if (SLACK_CUSTOM_FIELDS.TITLE) {
        profile.fields[SLACK_CUSTOM_FIELDS.TITLE] = { value: String(data[i][9] || "") };
      }

      const res = Core.slackApi("users.profile.set", { user: userId, profile: profile });
      
      if (res.ok) {
        sheet.getRange(i + 1, 11).setValue(new Date()); 
        count++;
      } else if (res.error === "cannot_update_admin_user") {
        console.warn(`Skipping profile update for Admin/Owner ${userId} (protected by Slack API permissions).`);
        adminSkipped++;
      } else {
        console.error(`Update failed for ${userId}: ${res.error}`);
      }
    }
    
    return `Push Complete: ${count} updated. ${skipped} deactivated users skipped. ${adminSkipped} admin accounts skipped (Slack admin protection).`;
  }
};

const PollWorkflow = {
  /**
   * Parses the /poll command and creates the initial message
   */
  createTimedPoll(channelId, rawText, defaultHours) {
    // Normalize smart/curly quotes to standard double quotes
    let cleanText = (rawText || "").replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"').trim();
    let durationHrs = defaultHours || 24;

    const timeMatch = cleanText.match(/\s+(\d+(?:\.\d+)?)\s*(h|m)$/i);
    if (timeMatch) {
      const val = parseFloat(timeMatch[1]);
      const unit = timeMatch[2].toLowerCase();
      durationHrs = (unit === 'h') ? val : val / 60;
      cleanText = cleanText.replace(timeMatch[0], "").trim();
    }

    const parts = cleanText.match(/"([^"]+)"/g) || [];
    if (parts.length < 2) {
      Core.slackApi("chat.postMessage", {
        channel: channelId,
        text: "⚠️ *Usage:* `/poll \"Question\" \"Option 1\" \"Option 2\" 2h` (Duration optional)"
      });
      return;
    }

    const question = parts[0].replace(/"/g, '');
    const options = parts.slice(1).map(o => o.replace(/"/g, ''));
    
    const now = new Date();
    const expiryDate = new Date(now.getTime() + (durationHrs * 60 * 60 * 1000));
    const pollId = "poll_" + now.getTime();

    const initialVoteState = options.map(o => ({ text: o, voters: [] }));
    const blocks = this.buildPollBlocks(pollId, question, options, initialVoteState, expiryDate, false);

    // Attempt to join channel first so bot is permitted to trigger @channel notifications
    try {
      Core.slackApi("conversations.join", { channel: channelId });
    } catch (_) {}

    const res = Core.slackApi("chat.postMessage", {
      channel: channelId,
      blocks: blocks,
      text: `<!channel> 📊 New Poll: ${question}`
    });

    if (res.ok) {
      const sheet = Core.getSheet("ActivePolls");
      sheet.appendRow([
        String(pollId),                      // Col A (Poll ID)
        question,                           // Col B
        "Open",                             // Col C
        now,                                // Col D
        expiryDate,                         // Col E
        channelId,                          // Col F
        "'" + String(res.ts),               // Col G (Message TS - apostrophe preserves string precision)
        JSON.stringify(initialVoteState)    // Col H
      ]);
    }
  },

  /**
   * Handles button clicks with zero-latency block parsing (Workaround 1)
   * Updates Slack immediately via response_url before syncing to Google Sheets.
   */
  handleVote(payload, actionValue) {
    if (!actionValue || !actionValue.includes("|")) return;

    const [pollId, optIndexStr] = actionValue.split("|");
    const targetOptIndex = parseInt(optIndexStr, 10);
    const userId = payload.user ? payload.user.id : null;
    if (!userId || isNaN(targetOptIndex)) return;

    // 1. Parse current poll state directly from payload.message.blocks (0ms latency)
    const msgBlocks = (payload.message && Array.isArray(payload.message.blocks)) ? payload.message.blocks : null;
    let pollData = null;

    if (msgBlocks && msgBlocks.length > 2) {
      const optionBlocks = msgBlocks.slice(2);
      pollData = optionBlocks.map(block => {
        const rawMrkdwn = (block.text && block.text.text) ? block.text.text : "";
        const lines = rawMrkdwn.split("\n");
        // Extract option title from first line: *Option Title*
        const optTitle = (lines[0] || "").replace(/^\*|\*$/g, "").trim();
        // Extract all <@U...> voter IDs from the remaining lines
        const voterMatches = lines.slice(1).join("\n").match(/<@(U[A-Z0-9]+)>/g) || [];
        const voters = voterMatches.map(m => m.replace(/<@|>/g, ""));
        return { text: optTitle, voters: voters };
      });
    }

    // 2. If blocks were present, apply single-choice vote toggle and update Slack IMMEDIATELY
    if (pollData && pollData[targetOptIndex]) {
      const alreadyVotedThis = pollData[targetOptIndex].voters.includes(userId);

      // Remove user from ALL options (restricts to 1 vote per user)
      pollData.forEach(opt => {
        opt.voters = opt.voters.filter(id => id !== userId);
      });

      // Toggle: add vote only if they weren't already voting for this option
      if (!alreadyVotedThis) {
        pollData[targetOptIndex].voters.push(userId);
      }

      // Rebuild updated blocks preserving the original header and divider
      const updatedBlocks = [msgBlocks[0], msgBlocks[1]];
      pollData.forEach((opt, i) => {
        const voteCount = opt.voters.length;
        const bar = voteCount > 0 ? "⦿".repeat(voteCount) : "○";
        const votersListStr = voteCount > 0 ? `\n${opt.voters.map(id => `<@${id}>`).join(" ")}` : "";

        updatedBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${opt.text}*\n${bar} *(${voteCount})*${votersListStr}`
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "Vote" },
            value: `${pollId}|${i}`,
            action_id: `v_${i}`
          }
        });
      });

      // Immediately update Slack via pre-signed response_url (~200ms total, never times out)
      if (payload.response_url) {
        try {
          UrlFetchApp.fetch(payload.response_url, {
            method: "post",
            contentType: "application/json; charset=utf-8",
            payload: JSON.stringify({
              replace_original: true,
              text: (payload.message && payload.message.text) || "📊 Poll Updated",
              blocks: updatedBlocks
            }),
            muteHttpExceptions: true
          });
        } catch (err) {
          console.error("Error updating via response_url: " + err);
        }
      }
    }

    // 3. Persist updated vote state to Google Sheet for expiration tracking
    try {
      const sheet = Core.getSheet("ActivePolls");
      const data = sheet.getDataRange().getValues();

      for (let i = data.length - 1; i >= 1; i--) {
        const sheetPollId = String(data[i][0]).trim();
        const status = String(data[i][2]).trim();
        if (sheetPollId === String(pollId).trim() && status.toLowerCase() === "open") {
          const rowIndex = i + 1;

          // If pollData wasn't parsed from blocks, fall back to sheet data
          if (!pollData) {
            pollData = typeof data[i][7] === "string" ? JSON.parse(data[i][7]) : data[i][7];
            const alreadyVoted = Array.isArray(pollData[targetOptIndex]?.voters) && pollData[targetOptIndex].voters.includes(userId);
            pollData.forEach(opt => {
              opt.voters = Array.isArray(opt.voters) ? opt.voters.filter(id => id !== userId) : [];
            });
            if (!alreadyVoted && pollData[targetOptIndex]) {
              pollData[targetOptIndex].voters.push(userId);
            }
          }

          sheet.getRange(rowIndex, 8).setValue(JSON.stringify(pollData));
          break;
        }
      }
    } catch (sheetErr) {
      console.error("Failed to sync vote state to sheet: " + sheetErr);
    }
  },

  /**
   * Closes expired polls and posts a results summary
   */
  checkExpirations() {
    const sheet = Core.getSheet("ActivePolls");
    const data = sheet.getDataRange().getValues();
    const now = new Date();

    for (let i = 1; i < data.length; i++) {
      const status = String(data[i][2]).trim();
      const expiryRaw = data[i][4];
      const expiryTime = (expiryRaw instanceof Date) ? expiryRaw.getTime() : new Date(expiryRaw).getTime();

      if (status.toLowerCase() === "open" && !isNaN(expiryTime) && expiryTime <= now.getTime()) {
        const pollId = String(data[i][0]).trim();
        const question = data[i][1];
        const channelId = String(data[i][5]).trim();
        const rawTs = String(data[i][6]).trim().replace(/^'/, "");
        let results = [];

        try {
          results = typeof data[i][7] === "string" ? JSON.parse(data[i][7]) : data[i][7];
        } catch (e) {
          console.error("Error parsing results JSON during expiration: " + e);
          continue;
        }

        // 1. Mark as Closed
        sheet.getRange(i + 1, 3).setValue("Closed");
        SpreadsheetApp.flush();

        // 2. Post Thread Summary with voter list
        let resultText = `🏁 *Poll Results: ${question}*\n`;
        results.forEach(r => {
          const voterList = Array.isArray(r.voters) ? r.voters : [];
          const voterMentions = voterList.length > 0 ? ` (${voterList.map(id => `<@${id}>`).join(", ")})` : "";
          resultText += `• *${r.text}*: ${voterList.length} vote${voterList.length === 1 ? '' : 's'}${voterMentions}\n`;
        });

        const threadRes = Core.slackApi("chat.postMessage", {
          channel: channelId,
          thread_ts: rawTs,
          text: resultText,
          link_names: 1
        });
        
        // 3. Update original message (remove buttons)
        const expiryDate = (expiryRaw instanceof Date) ? expiryRaw : new Date(expiryRaw);
        const blocks = this.buildPollBlocks(pollId, question, results.map(r => r.text), results, expiryDate, true);
        const updateRes = Core.slackApi("chat.update", { 
          channel: channelId, 
          ts: rawTs, 
          blocks: blocks,
          text: `📊 *Poll Closed:* ${question}`
        });

        console.log(`Poll [${pollId}] expired. Thread: ${threadRes.ok}, Update: ${updateRes.ok}`);
      }
    }
  },

  /**
   * UI Builder for the Slack Message with voter names
   */
  buildPollBlocks(pollId, question, options, voteState, expiry, isClosed = false) {
    const timeZone = Session.getScriptTimeZone();
    const timeStr = Utilities.formatDate(expiry, timeZone, "h:mm a");
    const statusText = isClosed ? "🔒 *CLOSED*" : `Voting ends at \`${timeStr}\``;
    
    const blocks = [
      {
        "type": "section",
        "text": { 
          "type": "mrkdwn", 
          "text": `<!channel>\n📊 *${question}*\n${statusText}` 
        }
      },
      { "type": "divider" }
    ];

    options.forEach((optText, i) => {
      const voters = (voteState && voteState[i] && Array.isArray(voteState[i].voters)) ? voteState[i].voters : [];
      const voteCount = voters.length;
      const bar = voteCount > 0 ? "⦿".repeat(voteCount) : "○";
      const votersListStr = voteCount > 0 ? `\n${voters.map(id => `<@${id}>`).join(" ")}` : "";
      
      const section = {
        "type": "section",
        "text": { 
          "type": "mrkdwn", 
          "text": `*${optText}*\n${bar} *(${voteCount})*${votersListStr}` 
        }
      };

      if (!isClosed) {
        section.accessory = {
          "type": "button",
          "text": { "type": "plain_text", "text": "Vote" },
          "value": `${pollId}|${i}`,
          "action_id": `v_${i}`
        };
      }

      blocks.push(section);
    });

    return blocks;
  }
};