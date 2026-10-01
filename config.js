/**
 * GLOBAL CONFIGURATION
 */
const POLL_BOT_TOKEN = PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");
const USER_TOKEN = PropertiesService.getScriptProperties().getProperty("USER_TOKEN");
const SUMMARY_CHANNEL_ID = PropertiesService.getScriptProperties().getProperty("SUMMARY_CHANNEL_ID");

const ROSTER_CONFIG = {
  SHEET_NAME: "Roster",
  COL_USER_ID: 1,      // Column A
  COL_REAL_NAME: 2,    // Column B
  COL_DISPLAY_NAME: 3, // Column C
  COL_EMAIL: 4,        // Column D
  COL_PHONE: 5,        // Column E
  COL_CHAPTER: 6,      // Column F
  COL_AGE_RANGE: 7,    // Column G
  COL_MEMBERSHIP: 8,   // Column H
  COL_MEMBER_GROUP: 9, // Column I
  COL_TITLE: 10,       // Column J
  COL_UPDATED: 11,     // Column K
  COL_STATUS: 12,      // Column L
};

/**
 * These match the unique Slack metadata IDs 
 * found in your workspace logs.
 */
const SLACK_CUSTOM_FIELDS = {
  TITLE: "Xf06NT787AG3",
  CHAPTER: "Xf09MGK1C86Q",
  AGE_RANGE: "Xf09N7BMLJTS",
  MEMBERSHIP: "Xf09NKRWFND6",
  MEMBER_GROUP: "Xf0A772PKPK9"
};