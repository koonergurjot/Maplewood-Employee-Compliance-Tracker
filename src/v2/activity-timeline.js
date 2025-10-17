import { openDatabase } from '../../db.js';
import { liveQuery } from 'dexie';

const TIMELINE_LIMIT = 50;

function mapActivities(records = []) {
  return records.map(record => ({
    id:
      record?.id ?? `${record?.createdAt || Date.now()}-${Math.random().toString(16).slice(2)}`,
    summary: typeof record?.summary === 'string' ? record.summary : '',
    createdAt: record?.createdAt || new Date().toISOString()
  }));
}

export function activityTimeline() {
  return {
    db: null,
    entries: [],
    loading: true,
    error: '',
    _subscription: null,
    _hookSubscriptions: [],
    _pollTimer: null,
    _refreshTimer: null,

    async init() {
      try {
        this.db = await openDatabase();
        await this.refresh();
        this.setupSubscription();
      } catch (error) {
        console.error('Failed to initialize activity timeline', error);
        this.error = 'Unable to load activity timeline.';
      } finally {
        this.loading = false;
      }
    },

    async refresh() {
      if (!this.db?.activities?.orderBy) {
        this.entries = [];
        return;
      }

      try {
        const records = await this.db.activities
          .orderBy('createdAt')
          .reverse()
          .limit(TIMELINE_LIMIT)
          .toArray();
        this.entries = mapActivities(records);
        this.error = '';
      } catch (error) {
        console.error('Failed to refresh activity timeline', error);
        this.error = 'Unable to load activity timeline.';
      } finally {
        this.loading = false;
      }
    },

    setupSubscription() {
      if (!this.db?.activities) {
        return;
      }

      const table = this.db.activities;
      if (typeof liveQuery === 'function') {
        try {
          const observable = liveQuery(() =>
            table.orderBy('createdAt').reverse().limit(TIMELINE_LIMIT).toArray()
          );
          this._subscription = observable.subscribe({
            next: records => {
              this.entries = mapActivities(records);
              this.error = '';
              this.loading = false;
            },
            error: err => {
              console.warn('Activity timeline live query failed', err);
              this.error = 'Unable to keep the activity timeline updated.';
            }
          });
          return;
        } catch (error) {
          console.warn('Failed to subscribe to liveQuery for activity timeline', error);
        }
      }

      if (typeof table.hook === 'function') {
        const queueRefresh = () => {
          if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
          }
          this._refreshTimer = setTimeout(() => {
            this.refresh().catch(err => {
              console.warn('Failed to refresh activity timeline after hook trigger', err);
            });
          }, 50);
        };

        ['creating', 'updating', 'deleting'].forEach(hookName => {
          const hook = table.hook(hookName);
          if (hook && typeof hook.subscribe === 'function') {
            const handler = () => queueRefresh();
            hook.subscribe(handler);
            this._hookSubscriptions.push({ hook, handler });
          }
        });
        return;
      }

      this._pollTimer = setInterval(() => {
        this.refresh().catch(err => {
          console.warn('Activity timeline poll failed', err);
        });
      }, 5000);
    },

    destroy() {
      if (this._subscription && typeof this._subscription.unsubscribe === 'function') {
        this._subscription.unsubscribe();
      }

      if (Array.isArray(this._hookSubscriptions)) {
        for (const { hook, handler } of this._hookSubscriptions) {
          try {
            hook.unsubscribe(handler);
          } catch (error) {
            console.warn('Failed to unsubscribe activity timeline hook', error);
          }
        }
        this._hookSubscriptions = [];
      }

      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }

      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
    }
  };
}
