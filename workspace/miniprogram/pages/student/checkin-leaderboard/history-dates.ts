export function previousActivityDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() - 1)
  return parsed.toISOString().slice(0, 10)
}

export function activityHistoryDates(startsOn: string, cursor: string, limit = 7): string[] {
  const result: string[] = []
  for (let date = cursor; date >= startsOn && result.length < limit; date = previousActivityDate(date)) {
    result.push(date)
  }
  return result
}

export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
