type EventListener<Args extends unknown[]> = (
  ...args: Args
) => void | Promise<void>;

class EventEmitter<
  Events extends Record<keyof Events, unknown[]> = Record<string, unknown[]>,
> {
  private listeners: {
    [EventName in keyof Events]?: EventListener<Events[EventName]>[];
  } = {};

  on<EventName extends keyof Events>(
    event: EventName,
    listener: EventListener<Events[EventName]>,
  ): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  off<EventName extends keyof Events>(
    event: EventName,
    listener: EventListener<Events[EventName]>,
  ): void {
    if (!this.listeners[event]) {
      return;
    }
    this.listeners[event] = this.listeners[event].filter(
      (registeredListener) => registeredListener !== listener,
    );
  }

  emit<EventName extends keyof Events>(
    event: EventName,
    ...args: Events[EventName]
  ): void {
    if (!this.listeners[event]) {
      return;
    }
    this.listeners[event].forEach((listener) => {
      void listener(...args);
    });
  }
}

export default EventEmitter;
