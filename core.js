const Core = {
  getSheet(name) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      if (name === ROSTER_CONFIG.SHEET_NAME) {
        sheet.appendRow([
          "User ID", "Real Name", "Display Name", "Email", "Phone",
          "Chapter", "Age Range", "Membership", "Member Group", "Title",
          "Updated At", "Status"
        ]);
      } else if (name === "ActivePolls") {
        sheet.appendRow([
          "Poll ID", "Question", "Status", "Created At", "Expires At",
          "Channel ID", "Message TS", "Vote State"
        ]);
      }
    }
    return sheet;
  },

  slackApi(endpoint, payload) {
    const isProfileUpdate = endpoint.includes("users.profile.set");
    const token = isProfileUpdate ? USER_TOKEN : POLL_BOT_TOKEN; 

    const options = {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { "Authorization": "Bearer " + token },
      payload: JSON.stringify(payload), 
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch("https://slack.com/api/" + endpoint, options);
    const result = JSON.parse(res.getContentText());
    
    if (!result.ok) {
      console.error(`Slack API Error [${endpoint}]: ${result.error}`, result);
    } else {
      console.log(`Slack Response [${endpoint}]: Success`);
    }
    return result;
  }
};