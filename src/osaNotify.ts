function escapeAppleScriptString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, ' ');
}

export function buildNotificationScript(title: string, body: string): string {
  return `display notification "${escapeAppleScriptString(body)}" with title "${escapeAppleScriptString(title)}"`;
}
