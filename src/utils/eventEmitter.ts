// src/utils/eventEmitter.ts
class EventEmitter {
    private listeners: { [event: string]: Function[] } = {};

    on(event: string, listener: Function): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(listener);
    }

    off(event: string, listener: Function): void {
        if (!this.listeners[event]) {
            return;
        }
        this.listeners[event] = this.listeners[event].filter(
            (l) => l !== listener,
        );
    }

    emit(event: string, ...args: any[]): void {
        if (!this.listeners[event]) {
            return;
        }
        this.listeners[event].forEach((listener) => {
            listener(...args);
        });
    }
}

export default EventEmitter;
