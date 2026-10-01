class RosterWorkflow {
  /**
   * PULL: Grabs everything from Slack and updates the Spreadsheet
   */
  static pullSlackData() {
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
        m.id,                                               // 0 (A) - ID
        getVal(m.real_name || p.real_name, existingRow[1]), // 1 (B) - Real Name
        getVal(p.display_name, existingRow[2]),             // 2 (C) - Display Name
        getVal(p.email, existingRow[3]),                    // 3 (D) - Email
        getVal(p.phone, existingRow[4]),                    // 4 (E) - Phone
        getVal(f[SLACK_CUSTOM_FIELDS.CHAPTER]?.value, existingRow[5]),     // 5 (F)
        getVal(f[SLACK_CUSTOM_FIELDS.AGE_RANGE]?.value, existingRow[6]),   // 6 (G)
        getVal(f[SLACK_CUSTOM_FIELDS.MEMBERSHIP]?.value, existingRow[7]),  // 7 (H)
        getVal(f[SLACK_CUSTOM_FIELDS.MEMBER_GROUP]?.value, existingRow[8]),// 8 (I)
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
  }

  /**
   * PUSH: Takes Spreadsheet edits and sends them to Slack.
   * Skips accounts where Column L (Status) is "Deactivated".
   */
  static bulkPushToSlack() {
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
}

class PollWorkflow {
  /**
   * Parses the /poll command and creates the initial message
   */
  static createTimedPoll(channelId, rawText, defaultHours) {
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

    const res = Core.slackApi("chat.postMessage", {
      channel: channelId,
      blocks: blocks,
      text: `<!channel> 📊 New Poll: ${question}`,
      link_names: true
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
  }

  /**
   * Handles button clicks and returns updated Block Kit response
   */
  static handleVote(payload, actionValue) {
    if (!actionValue || !actionValue.includes("|")) return null;

    const [pollId, optIndexStr] = actionValue.split("|");
    const targetOptIndex = parseInt(optIndexStr, 10);
    const userId = payload.user ? payload.user.id : null;
    if (!userId) return null;

    const sheet = Core.getSheet("ActivePolls");
    const data = sheet.getDataRange().getValues();
    
    let rowIndex = -1;
    let pollData = null;

    // Search sheet for matching poll ID
    for (let i = 1; i < data.length; i++) {
      const sheetPollId = String(data[i][0]).trim();
      const status = String(data[i][2]).trim();
      if (sheetPollId === String(pollId).trim() && status.toLowerCase() === "open") {
        rowIndex = i + 1;
        try {
          pollData = JSON.parse(data[i][7]);
        } catch (e) {
          console.error("Failed to parse poll JSON in sheet: " + e);
        }
        break;
      }
    }

    if (!pollData || rowIndex === -1) {
      console.warn(`Poll target not found or already closed for pollId: ${pollId}`);
      return null;
    }

    // Toggle vote logic
    pollData.forEach((opt, idx) => {
      if (!Array.isArray(opt.voters)) opt.voters = [];
      const voterIdx = opt.voters.indexOf(userId);

      if (idx === targetOptIndex) {
        if (voterIdx === -1) {
          opt.voters.push(userId);
        } else {
          opt.voters.splice(voterIdx, 1);
        }
      }
    });

    // Save updated vote tally to Sheet
    sheet.getRange(rowIndex, 8).setValue(JSON.stringify(pollData));

    // Re-render blocks
    const expiryRaw = data[rowIndex - 1][4];
    const expiryDate = (expiryRaw instanceof Date) ? expiryRaw : new Date(expiryRaw);
    const question = data[rowIndex - 1][1];
    const options = pollData.map(p => p.text);
    const blocks = this.buildPollBlocks(pollId, question, options, pollData, expiryDate, false);

    // Return replacement message payload for direct in-channel update (eliminates timeouts)
    return {
      response_type: "in_channel",
      replace_original: true,
      text: `<!channel> 📊 Poll: ${question}`,
      blocks: blocks
    };
  }

  /**
   * Closes expired polls and posts a results summary
   */
  static checkExpirations() {
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
          results = JSON.parse(data[i][7]);
        } catch (e) {
          console.error("Error parsing results JSON during expiration: " + e);
          continue;
        }

        // 1. Mark as Closed
        sheet.getRange(i + 1, 3).setValue("Closed");

        // 2. Post Thread Summary
        let resultText = `🏁 *Poll Results: ${question}*\n`;
        results.forEach(r => {
          const voterList = Array.isArray(r.voters) ? r.voters : [];
          resultText += `• *${r.text}*: ${voterList.length} votes\n`;
        });

        const threadRes = Core.slackApi("chat.postMessage", {
          channel: channelId,
          thread_ts: rawTs,
          text: resultText
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
  }

  /**
   * UI Builder for the Slack Message
   */
  static buildPollBlocks(pollId, question, options, voteState, expiry, isClosed = false) {
    const timeZone = Session.getScriptTimeZone();
    const timeStr = Utilities.formatDate(expiry, timeZone, "h:mm a");
    const statusText = isClosed ? "*CLOSED*" : `Voting ends at \`${timeStr}\``;
    
    const blocks = [
      {
        "type": "section",
        "text": { "type": "mrkdwn", "text": `📊 *${question}*\n<!channel> — ${statusText}` }
      },
      { "type": "divider" }
    ];

    options.forEach((optText, i) => {
      const voteCount = (voteState && voteState[i] && voteState[i].voters) ? voteState[i].voters.length : 0;
      const bar = voteCount > 0 ? "⦿".repeat(voteCount) : "○";
      
      const section = {
        "type": "section",
        "text": { "type": "mrkdwn", "text": `*${optText}*\n${bar} _(${voteCount} votes)_` }
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
}