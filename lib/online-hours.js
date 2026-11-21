// An empty window preserves the existing manager-controlled open/paused switch.
export function validOnlineHours(value) {
  return value === '' || (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) &&
    value.slice(0, 5) !== value.slice(6));
}

export function onlineHours(settings) {
  const window = settings.onlineOrderHours;
  if (!window) return {includes: () => true, opens: null};
  const [opens, closes] = window.split('-');
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timeZone || 'Asia/Colombo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit'
  });
  return {opens, includes(timestamp) {
    const time = clock.format(timestamp);
    return opens < closes ? time >= opens && time < closes : time >= opens || time < closes;
  }};
}
