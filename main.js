function doPost(e) {
  if (!e) return ContentService.createTextOutput("");

  try {
    let params = e.parameter || {};

    // Fallback if payload/command arrives in postData
    if (!params.command && !params.payload && e.postData && e.postData.contents) {
      try {
        if (e.postData.type === "application/json") {
          params = JSON.parse(e.postData.contents);
        }
      } catch (_) {}
    }

    // 1. Handle Slash Command (/poll)
    if (params.command === "/poll") {
      const rawText = params.text || "";
      const channelId = params.channel_id;
      
      PollWorkflow.createTimedPoll(channelId, rawText, 24);
      return ContentService.createTextOutput(""); 
    }

    // 2. Handle Interactive Buttons (Block Actions)
    if (params.payload) {
      const payload = typeof params.payload === "string" ? JSON.parse(params.payload) : params.payload;
      
      if (payload.type === "block_actions" && payload.actions && payload.actions.length > 0) {
        const actionValue = payload.actions[0].value;
        const responsePayload = PollWorkflow.handleVote(payload, actionValue);
        if (responsePayload) {
          return ContentService.createTextOutput(JSON.stringify(responsePayload))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
  } catch (err) {
    console.error("System Error in doPost: " + (err.stack || err.toString()));
  }

  // Always return HTTP 200 OK to Slack immediately
  return ContentService.createTextOutput("");
}

// Sync Roster (Both Ways) + Send Summary
function runDailySync() {
  const pullMsg = RosterWorkflow.pullSlackData();
  const pushMsg = RosterWorkflow.bulkPushToSlack();
  
  const summary = `🔄 *Daily Roster Sync Summary*\n• ${pullMsg}\n• ${pushMsg}`;
  Core.slackApi("chat.postMessage", { 
    channel: SUMMARY_CHANNEL_ID, 
    text: summary 
  });
}

// Poll Expiry Check (Trigger runs every minute)
function minuteTrigger() {
  PollWorkflow.checkExpirations();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Roster Bot')
    .addItem('Step 1: Pull from Slack (Update Sheet)', 'manualPull')
    .addItem('Step 2: Push to Slack (Update Slack)', 'manualPush')
    .addToUi();
}

function manualPull() {
  const msg = RosterWorkflow.pullSlackData();
  SpreadsheetApp.getUi().alert(msg);
}

function manualPush() {
  const msg = RosterWorkflow.bulkPushToSlack();
  SpreadsheetApp.getUi().alert(msg);
}