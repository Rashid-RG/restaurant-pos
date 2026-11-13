// Synchronous guard for user-triggered async actions. React state updates are not immediate.
// A rejected action releases the guard so the customer can safely retry.
export function createSubmissionGuard() {
  let active = false;
  return {
    get active() { return active; },
    async run(action) {
      if (active) return { skipped: true };
      active = true;
      try { return { skipped: false, result: await action() }; }
      finally { active = false; }
    }
  };
}
