// Public API address only. No passwords or server secrets belong in this file.
export const backendBaseUrl = 'https://video.aimanhua.xin';
// Match the deployed backend; do not offer an SMS flow before it is configured.
export const backendCapabilities = { smsPasswordRecovery: false };
// Keep in sync with DOCUMENTATION.md baseline; the login footer shows this value
// and is the quickest way to tell whether a preview contains the current code.
export const miniProgramVersion = '0.130.1';
