import { nextDailyUtcHour } from '../utils.js';

export class Scheduler {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm) {
      await this.state.storage.setAlarm(nextDailyUtcHour(3));
    }

    return new Response('ok');
  }

  async alarm() {
    const retentionDays = Number(this.env.MESSAGE_RETENTION_DAYS || 7);
    await this.env.DB.prepare(
      `UPDATE messages
       SET deleted_at = CURRENT_TIMESTAMP
       WHERE deleted_at IS NULL
         AND created_at < datetime('now', ?)`
    )
      .bind(`-${retentionDays} day`)
      .run();

    await this.state.storage.setAlarm(nextDailyUtcHour(3));
  }
}
